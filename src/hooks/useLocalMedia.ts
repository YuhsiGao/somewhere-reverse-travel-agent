import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type LocalMediaKind = 'image' | 'audio';

export type LocalMedia = {
  kind: LocalMediaKind;
  file: File;
  url: string;
  durationSeconds?: number;
};

/** A deliberately small, display-safe contract for an explicitly authorized image analysis. */
export type ImageInsight = {
  label: string;
};

const MEDIA_RULES = {
  image: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 10 * 1024 * 1024,
    label: 'JPG、PNG 或 WebP 图片（不超过 10MB）',
  },
  audio: {
    accept: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav'],
    maxBytes: 15 * 1024 * 1024,
    label: 'MP3、M4A 或 WAV 音频（不超过 15MB）',
  },
} as const;

export function validateLocalMedia(file: File, kind: LocalMediaKind): string | null {
  const rule = MEDIA_RULES[kind];
  const extension = file.name.toLowerCase().split('.').pop();
  const supportedExtension = kind === 'image'
    ? ['jpg', 'jpeg', 'png', 'webp'].includes(extension ?? '')
    : ['mp3', 'm4a', 'wav'].includes(extension ?? '');

  if (!rule.accept.includes(file.type as never) && !supportedExtension) {
    return `请选择${rule.label}。`;
  }
  if (file.size > rule.maxBytes) return `${kind === 'image' ? '图片' : '音频'}超过大小限制，请换一个更小的文件。`;
  return null;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '正在读取时长…';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export function normalizeImageInsights(value: unknown): ImageInsight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('label' in item) || typeof item.label !== 'string') return [];
    const label = item.label.replace(/\s+/g, ' ').trim().slice(0, 80);
    return label ? [{ label }] : [];
  }).slice(0, 8);
}

/**
 * `media` is intentionally not serialized. This parameter remains for callers that
 * already pass their local selection; only words and explicitly authorized insights
 * can cross the component boundary.
 */
export function localMediaSummary(_media: LocalMedia[], description: string, imageInsights: ImageInsight[] = [], audioTranscript = ''): string {
  const cleanDescription = description.trim();
  const cleanTranscript = audioTranscript.trim();
  const insights = normalizeImageInsights(imageInsights);
  const parts = [
    cleanDescription ? `用户文字偏好：${cleanDescription}` : '',
    insights.length ? `已确认的图片洞察：${insights.map((item) => item.label).join('、')}` : '',
    cleanTranscript ? `用户确认的声音转写：${cleanTranscript}` : '',
  ].filter(Boolean);
  return parts.join('；');
}

export function useLocalMedia() {
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [error, setError] = useState('');
  const mediaRef = useRef<LocalMedia[]>([]);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  const add = useCallback((file: File, kind: LocalMediaKind) => {
    const validationError = validateLocalMedia(file, kind);
    if (validationError) {
      setError(validationError);
      return false;
    }
    setError('');
    setMedia((current) => {
      const duplicateKind = current.find((item) => item.kind === kind);
      if (duplicateKind) URL.revokeObjectURL(duplicateKind.url);
      return [...current.filter((item) => item.kind !== kind), { kind, file, url: URL.createObjectURL(file) }];
    });
    return true;
  }, []);

  const remove = useCallback((kind: LocalMediaKind) => {
    setMedia((current) => {
      current.filter((item) => item.kind === kind).forEach((item) => URL.revokeObjectURL(item.url));
      return current.filter((item) => item.kind !== kind);
    });
    setError('');
  }, []);

  const setDuration = useCallback((kind: LocalMediaKind, durationSeconds: number) => {
    setMedia((current) => current.map((item) => item.kind === kind ? { ...item, durationSeconds } : item));
  }, []);

  useEffect(() => () => mediaRef.current.forEach((item) => URL.revokeObjectURL(item.url)), []);

  return useMemo(() => ({ media, error, add, remove, setDuration }), [media, error, add, remove, setDuration]);
}
