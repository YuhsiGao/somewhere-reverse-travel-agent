import { ArrowRight, Check } from 'lucide-react';
import type { Destination } from '../types';

export type CandidateComparisonProps = { places: Destination[]; onChoose: (place: Destination) => void; source?: 'agent' | 'editorial' };
export const decisionActionLabel = (place: Pick<Destination, 'city'>) => `查看${place.city}的旅行方案`;

/** This comparison preserves provenance: neither source is a live travel-supply check. */
export default function CandidateComparison({ places, onChoose, source = 'editorial' }: CandidateComparisonProps) {
  if (places.length < 2) return null;
  return <section className="candidate-comparison" aria-labelledby="candidate-comparison-title">
    <header><span className="section-kicker">DECISION LENS · {source === 'agent' ? 'AGENT RECALL' : 'EDITORIAL'}</span><h3 id="candidate-comparison-title">把相似的心动，放进同一把尺子里</h3><p>{source === 'agent' ? 'Agent 动态召回的匹配和取舍，不是实时票价、班次、营业或签证结论。' : '编辑库的匹配和取舍，不是实时票价、班次、营业或签证结论。'}</p></header>
    <div className="candidate-comparison__scroll"><table><thead><tr><th scope="col">这次怎么选</th>{places.map((place) => <th scope="col" key={place.id}><span>{place.roleLabel}</span><strong>{place.city}</strong><small>{place.region} · {place.country}</small></th>)}</tr></thead><tbody>
      <tr><th scope="row">{source === 'agent' ? 'Agent 匹配' : '编辑库匹配'}</th>{places.map((place) => <td key={place.id}><b>{place.matchScore}%</b><small>{source === 'agent' ? '本次提示词与确认条件' : '文字偏好与确认条件重排'}</small></td>)}</tr>
      <tr><th scope="row">预算提示</th>{places.map((place) => <td key={place.id}>{place.budget}<small>{source === 'agent' ? 'Agent 草案，非实时价格' : '编辑示例，非实时价格'}</small></td>)}</tr>
      <tr><th scope="row">适合的季节</th>{places.map((place) => <td key={place.id}>{place.season}</td>)}</tr>
      <tr><th scope="row">愿意接受的取舍</th>{places.map((place) => <td key={place.id}>{place.tradeoff}</td>)}</tr>
      <tr><th scope="row">下一步</th>{places.map((place) => <td key={place.id}><button type="button" aria-label={decisionActionLabel(place)} onClick={() => onChoose(place)}><Check size={13} /> 看方案 <ArrowRight size={13} /></button></td>)}</tr>
    </tbody></table></div>
  </section>;
}
