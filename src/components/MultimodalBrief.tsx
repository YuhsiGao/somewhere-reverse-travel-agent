import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { formatDuration, localMediaSummary, normalizeImageInsights, useLocalMedia, type ImageInsight, type LocalMediaKind } from '../hooks/useLocalMedia';
import { MediaInsightError } from '../services/media-insight';

export type MultimodalBriefProps = {
  /** Only user words and explicitly authorized, structured image insights are returned. */
  onChange: (summary: string) => void;
  /** Called only after the user checks consent and explicitly requests image analysis. */
  onAnalyzeImage?: (file: File, description: string) => Promise<ImageInsight[]> | ImageInsight[];
  /** Called only after a person explicitly asks to analyze a pasted public URL. */
  onAnalyzeImageUrl?: (url: string, description: string) => Promise<ImageInsight[]> | ImageInsight[];
};

const accepted = {
  image: '.jpg,.jpeg,.png,.webp',
  audio: '.mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav',
} as const;

type SpeechRecognizer = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
type SpeechRecognizerConstructor = new () => SpeechRecognizer;

export default function MultimodalBrief({ onChange, onAnalyzeImage, onAnalyzeImageUrl }: MultimodalBriefProps) {
  const { media, error, add, remove, setDuration } = useLocalMedia();
  const [description, setDescription] = useState('');
  const [imageAnalysisConsent, setImageAnalysisConsent] = useState(false);
  const [imageInsights, setImageInsights] = useState<ImageInsight[]>([]);
  const [imageAnalysisState, setImageAnalysisState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [imageAnalysisError, setImageAnalysisError] = useState('');
  const [manualImageKeywords, setManualImageKeywords] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [urlPreviewFailed, setUrlPreviewFailed] = useState(false);
  const [audioTranscript, setAudioTranscript] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'unsupported' | 'error'>('idle');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const speechRef = useRef<SpeechRecognizer | null>(null);
  // This stable id lets the hero's “加入一张图片” action open the same real
  // file picker without relying on a document-wide click interceptor.
  const imageInputId = 'somewhere-image-inspiration-upload';
  const audioInputId = useId();
  const image = media.find((item) => item.kind === 'image');
  const audio = media.find((item) => item.kind === 'audio');

  useEffect(() => {
    onChange(localMediaSummary(media, [description, manualImageKeywords.trim() ? `图片关键词（用户填写）：${manualImageKeywords.trim()}` : ''].filter(Boolean).join('\n'), imageInsights, audioTranscript));
  }, [media, description, manualImageKeywords, imageInsights, audioTranscript, onChange]);

  const takeFile = (kind: LocalMediaKind, file?: File) => {
    if (file && add(file, kind) && kind === 'image') {
      setImageAnalysisConsent(false);
      setImageInsights([]);
      setImageAnalysisState('idle');
      setImageAnalysisError('');
    }
  };
  const onFileChange = (kind: LocalMediaKind) => (event: ChangeEvent<HTMLInputElement>) => {
    takeFile(kind, event.target.files?.[0]);
    event.target.value = '';
  };
  const onDrop = (kind: LocalMediaKind) => (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    takeFile(kind, event.dataTransfer.files[0]);
  };

  const removeImage = () => {
    remove('image');
    setImageAnalysisConsent(false);
    setImageInsights([]);
    setImageAnalysisState('idle');
    setImageAnalysisError('');
  };

  const describeAudioInWords = () => {
    descriptionRef.current?.focus();
    if (!description.trim()) setDescription('听起来像……我希望这趟旅行也有这种节奏：');
  };

  const analyzeImage = async () => {
    if (!image || !imageAnalysisConsent || !onAnalyzeImage) return;
    setImageAnalysisState('loading');
    setImageAnalysisError('');
    try {
      const insights = normalizeImageInsights(await onAnalyzeImage(image.file, description));
      setImageInsights(insights);
      setImageAnalysisState('success');
    } catch (error) {
      setImageInsights([]);
      setImageAnalysisState('error');
      setImageAnalysisError(error instanceof MediaInsightError ? error.message : '图片分析暂时未完成，原始图片仍只保留在本地。你可以稍后重试，或继续仅使用文字偏好。');
    }
  };

  const analyzeImageUrl = async () => {
    if (!imageUrl.trim() || !onAnalyzeImageUrl) return;
    setImageAnalysisState('loading');
    setImageAnalysisError('');
    try {
      const insights = normalizeImageInsights(await onAnalyzeImageUrl(imageUrl.trim(), description));
      setImageInsights(insights);
      setImageAnalysisState('success');
    } catch (error) {
      setImageInsights([]);
      setImageAnalysisState('error');
      setImageAnalysisError(error instanceof MediaInsightError ? error.message : '图片链接无法分析。请确认它是可公开访问的 HTTPS 图片，或换成本地上传。');
    }
  };

  const startVoiceNote = () => {
    const win = window as typeof window & { SpeechRecognition?: SpeechRecognizerConstructor; webkitSpeechRecognition?: SpeechRecognizerConstructor };
    const Recognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Recognition) { setVoiceState('unsupported'); return; }
    const recognition = new Recognition();
    speechRef.current = recognition;
    recognition.lang = 'zh-CN'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (event) => setAudioTranscript(Array.from(event.results).map((result) => result[0]?.transcript ?? '').join('').trim());
    recognition.onerror = () => setVoiceState('error');
    recognition.onend = () => setVoiceState((current) => current === 'listening' ? 'idle' : current);
    setVoiceState('listening');
    recognition.start();
  };
  const stopVoiceNote = () => speechRef.current?.stop();

  return <section id="multimodal-brief" className="multimodal-brief" aria-labelledby="multimodal-brief-title">
    <div className="multimodal-brief__heading">
      <p className="eyebrow">LOCAL ONLY</p>
      <h3 id="multimodal-brief-title">带一段灵感来</h3>
      <p>贴一张图，或说一段声音。模型只提取你确认过的旅行感觉，随后和文字一起参与目的地召回。</p>
    </div>

    <div className="multimodal-brief__uploads">
      <label className="multimodal-brief__dropzone" htmlFor={imageInputId} onDragOver={(event) => event.preventDefault()} onDrop={onDrop('image')}>
        <span>图片灵感</span><small>JPG / PNG / WebP · ≤10MB</small>
        <input id={imageInputId} type="file" accept={accepted.image} onChange={onFileChange('image')} />
      </label>
      <label className="multimodal-brief__dropzone" htmlFor={audioInputId} onDragOver={(event) => event.preventDefault()} onDrop={onDrop('audio')}>
        <span>声音灵感（本地）</span><small>MP3 / M4A / WAV · ≤15MB</small>
        <input id={audioInputId} type="file" accept={accepted.audio} onChange={onFileChange('audio')} />
      </label>
    </div>

    <div className="multimodal-brief__analysis">
      <label className="multimodal-brief__description"><span>或粘贴一张公开图片链接</span><input value={imageUrl} onChange={(event) => { setImageUrl(event.target.value.slice(0, 2000)); setUrlPreviewFailed(false); }} placeholder="https://…/a-photo.jpg" inputMode="url" /></label>
      {imageUrl.trim() && <div className="multimodal-brief__url-preview">{urlPreviewFailed ? <span>链接无法预览，但仍可尝试分析。</span> : <img src={imageUrl.trim()} alt="图片链接预览" onError={() => setUrlPreviewFailed(true)} />}<button type="button" onClick={analyzeImageUrl} disabled={imageAnalysisState === 'loading'}>{imageAnalysisState === 'loading' ? '正在理解图片…' : '理解这张图片'}</button></div>}
      <small>仅支持可公开访问的 HTTPS 图片；点击理解后才会把链接交给图片模型。</small>
    </div>

    {(image || imageUrl.trim()) && <label className="multimodal-brief__description multimodal-brief__manual-keywords"><span>从图中取几个词（可选）</span><input value={manualImageKeywords} onChange={(event) => setManualImageKeywords(event.target.value.slice(0, 180))} placeholder="例如：雾、旧街、海风、一个人慢走" /><small>这是你手动确认的关键词，不会被标记为 AI 图片理解；即使图片服务忙碌也会参与推荐。</small></label>}

    {error && <p className="multimodal-brief__alert" role="alert">{error}</p>}

    {image && <article className="multimodal-brief__preview" aria-label="图片预览">
      <img src={image.url} alt={`本地图片预览：${image.file.name}`} />
      <div><strong>{image.file.name}</strong><small>{imageAnalysisState === 'success' ? '已分析 · 已确认洞察会纳入本次偏好' : '仅本地预览 · 未由 AI 解析'}</small></div>
      <button type="button" onClick={removeImage} aria-label="移除图片">移除</button>
    </article>}
    {image && <div className="multimodal-brief__analysis" aria-live="polite">
      {onAnalyzeImage ? <>
        <label><input type="checkbox" checked={imageAnalysisConsent} onChange={(event) => {
          const consented = event.target.checked;
          setImageAnalysisConsent(consented);
          if (!consented) {
            setImageInsights([]);
            setImageAnalysisState('idle');
            setImageAnalysisError('');
          }
        }} disabled={imageAnalysisState === 'loading'} /> 我同意将这张图片发送给图片理解服务，仅用于生成本次旅行偏好洞察。</label>
        <button type="button" onClick={analyzeImage} disabled={!imageAnalysisConsent || imageAnalysisState === 'loading'}>
          {imageAnalysisState === 'loading' ? '正在分析图片…' : '试验性分析这张图片'}
        </button>
        {imageAnalysisState === 'success' && <p><strong>已分析</strong>{imageInsights.length ? `：${imageInsights.map((item) => item.label).join('、')}` : '：未提取到可确认的图片洞察。'}</p>}
        {imageAnalysisState === 'error' && <p className="multimodal-brief__alert" role="alert">{imageAnalysisError}</p>}
      </> : <p>当前未接入图片理解服务；图片保持本地预览，未由 AI 解析。</p>}
    </div>}
    <div className="multimodal-brief__analysis" aria-live="polite">
      <strong>用声音说说你想去哪里</strong>
      <p>说一句就够，例如“我想找一个没有人催我的海边”。浏览器会先转成可编辑文字，只有文字会进入 Agent。</p>
      <button type="button" onClick={voiceState === 'listening' ? stopVoiceNote : startVoiceNote}>{voiceState === 'listening' ? '结束聆听' : '开始说一段'}</button>
      {voiceState === 'unsupported' && <p className="multimodal-brief__alert">当前浏览器不支持语音转写；你仍可以直接在下方写下听感。</p>}
      {voiceState === 'error' && <p className="multimodal-brief__alert">没有成功听清这段声音，请重试或直接写下来。</p>}
      <label className="multimodal-brief__description"><span>声音转写（可修改）</span><textarea value={audioTranscript} onChange={(event) => setAudioTranscript(event.target.value.slice(0, 600))} placeholder="说完后会出现在这里；也可以直接输入。" rows={2} /></label>
    </div>
    {audio && <article className="multimodal-brief__preview" aria-label="音频预览">
      <audio controls src={audio.url} onLoadedMetadata={(event) => setDuration('audio', event.currentTarget.duration)} onError={() => remove('audio')} />
      <div><strong>{audio.file.name}</strong><small>仅本地播放 · {formatDuration(audio.durationSeconds)}</small><button className="multimodal-brief__text-link" type="button" onClick={describeAudioInWords}>把听感写成文字偏好</button></div>
      <button type="button" onClick={() => remove('audio')} aria-label="移除音频">移除</button>
    </article>}

    <label className="multimodal-brief__description">
      <span>这份灵感让你想到什么？</span>
      <textarea ref={descriptionRef} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：像黄昏的海风，想慢一点，不想去拥挤的地方。" rows={3} />
    </label>
    <p className="multimodal-brief__privacy">隐私说明：本地文件刷新或移除后立即失效。上传图片须勾选授权才会发送；图片链接须点击理解才会发送。语音通过浏览器转写为文字，音频文件本身不会上传。进入目的地 Agent 的只有你确认的文字与标签。</p>
  </section>;
}
