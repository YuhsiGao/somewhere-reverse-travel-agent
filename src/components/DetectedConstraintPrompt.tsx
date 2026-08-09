export type DetectedConstraintPromptProps = { budget?: 'low' | 'medium' | 'flexible'; transport?: string; onApply: () => void };

export default function DetectedConstraintPrompt({ budget, transport, onApply }: DetectedConstraintPromptProps) {
  if (!budget && !transport) return null;
  return <section className="section-wrap" aria-label="待确认的文本条件"><div className="privacy"><span className="dot" /> 文本检测到、尚未自动应用：{budget && <span className="constraint">预算：{budget === 'low' ? '尽量低' : budget === 'medium' ? '适中' : '灵活'}</span>}{transport && <span className="constraint">交通：{transport}</span>}<button className="edit-link" onClick={onApply}>确认应用这些条件</button></div></section>;
}
