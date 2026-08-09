import { KeyRound, Server, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TOKENHUB_GATEWAY, type ConnectionSettings } from '../services/connection-settings';

type ConnectionSettingsProps = {
  value: ConnectionSettings;
  onSave: (value: ConnectionSettings) => void;
  onClose: () => void;
  required?: boolean;
};

/** A small BYOK control room. The secret field remains session-only and is
 * intentionally never written to persistent browser storage. */
export default function ConnectionSettingsDialog({ value, onSave, onClose, required = false }: ConnectionSettingsProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const change = (key: keyof ConnectionSettings) => (next: string) => setDraft((current) => ({ ...current, [key]: next }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); onSave(draft); };
  return <div className="modal-backdrop connection-backdrop" onMouseDown={onClose}>
    <form className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" type="button" aria-label="关闭连接设置" onClick={onClose}><X size={18} /></button>
      <p className="section-kicker">GLOBAL CONNECTION · THIS DEVICE</p>
      <h2 id="connection-dialog-title">模型连接设置</h2>
      {required && <div className="connection-required" role="alert"><KeyRound size={16} /><span>请先配置 TokenHub Key，才能继续使用 AI 解析、目的地召回和图片理解。</span></div>}
      <p className="connection-modal__intro">这些设置会同时用于偏好解析、目的地召回与图片理解。更换模型后，从下一次请求生效。</p>
      <label><span>模型网关</span><div className="connection-modal__gateway"><Server size={15} /><input value={draft.gateway} onChange={(event) => change('gateway')(event.target.value)} aria-describedby="gateway-note" /></div><small id="gateway-note">当前版本仅允许 TokenHub 官方网关：{TOKENHUB_GATEWAY}</small></label>
      <div className="connection-modal__models">
        <label><span>旅行 Agent 模型</span><input value={draft.agentModel} onChange={(event) => change('agentModel')(event.target.value)} placeholder="hy3" autoCapitalize="none" spellCheck={false} /></label>
        <label><span>图片理解模型</span><input value={draft.visionModel} onChange={(event) => change('visionModel')(event.target.value)} placeholder="youtu-vita" autoCapitalize="none" spellCheck={false} /></label>
      </div>
      <label><span><KeyRound size={14} /> TokenHub Key <b className="connection-required-mark">必填</b></span><input type="password" value={draft.apiKey} onChange={(event) => change('apiKey')(event.target.value)} placeholder="粘贴你的 TokenHub Key" autoComplete="off" spellCheck={false} required={required} /><small>仅保留在当前浏览器会话；不会写入本地持久存储，也不会发送到除 TokenHub 外的地址。</small></label>
      <div className="connection-modal__actions"><button type="button" className="text-button" onClick={() => setDraft((current) => ({ ...current, apiKey: '' }))}>清除会话 Key</button><button className="dark-button" type="submit">保存并用于下一次请求</button></div>
    </form>
  </div>;
}
