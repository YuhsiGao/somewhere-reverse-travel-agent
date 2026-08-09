import type { Destination, Scenario, VibeProfile } from './types';
import { domesticItineraryVariantsFor, itineraryFor } from './data/itineraries';

export const inspirations = [
  { label: '轻微孤独的海边小城', text: '我想一个人待三天。天气有点冷，可以一直走路，游客不要太多，晚上能找到安静的小酒馆。', scenario: 'harbor' as Scenario },
  { label: '海街日记式夏天', text: '想找一个像《海街日记》一样的地方，有电车、海风、旧房子和很慢的夏天。', scenario: 'summer' as Scenario },
  { label: '周末国内降噪', text: '从上海出发，周末两天，不想打卡，不要古镇商业街，只想散步、喝茶、看看水。', scenario: 'domestic' as Scenario },
  { label: '给生活留一块空白', text: '最近有点累，想去一个不需要完成任何事的地方，能慢慢走路，晚上早点睡。', scenario: 'harbor' as Scenario },
];

export const vibes: Record<Scenario, VibeProfile> = {
  harbor: { summary: '你想要的是一段有边界的独处：空气偏冷，脚下有路，夜里仍然留着一点人间烟火。', emotions: [{ label: '安静', score: 88 }, { label: '独处', score: 82 }, { label: '清冷', score: 76 }, { label: '步行', score: 91 }, { label: '非热门', score: 74 }, { label: '夜晚有生活', score: 65 }], environments: ['海边', '旧建筑', '坡道', '小酒馆'], pace: '慢速', socialDensity: '独处为主', climate: '偏冷 · 潮湿', constraints: ['3 天', '预算适中', '游客较少'] },
  summer: { summary: '你在寻找一种被海风托住的慢夏天：有日常交通与旧房子，但没有必须打卡的清单。', emotions: [{ label: '松弛', score: 92 }, { label: '怀旧', score: 84 }, { label: '温柔', score: 78 }, { label: '慢生活', score: 90 }, { label: '海风', score: 86 }, { label: '轻社交', score: 61 }], environments: ['海边', '电车', '旧房子', '街角食堂'], pace: '慢速', socialDensity: '轻社交', climate: '温和 · 有风', constraints: ['3 天', '不追热门', '适合散步'] },
  domestic: { summary: '你不是想逃得很远，而是想把周末的音量调低：有水、有茶、有可以不被打扰的路。', emotions: [{ label: '降噪', score: 94 }, { label: '松弛', score: 87 }, { label: '自然', score: 82 }, { label: '步行', score: 88 }, { label: '少商业化', score: 91 }, { label: '留白', score: 79 }], environments: ['山水', '茶园', '村落', '溪流'], pace: '慢速', socialDensity: '独处为主', climate: '温和 · 清润', constraints: ['周末 2 天', '国内', '从上海出发'] },
};

const baseImages = {
  hakodate: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1200&q=80',
  whitby: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=80',
  porto: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1200&q=80',
  kamakura: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=80',
  matsuyama: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=80',
  songyang: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80',
  liyang: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  ninghai: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=80',
};

export const destinations: Record<Scenario, Destination[]> = {
  harbor: [
    { id: 'hakodate', city: '函馆', region: '北海道', country: '日本', role: 'best-match', roleLabel: '最像你描述的地方', matchScore: 94, tagline: '海风把旧港口的声音调低了一格。', atmosphere: ['港口', '坡道', '旧建筑', '安静酒馆'], reasons: ['步行路线自然串起港口与旧街区', '游客密度相对友好，夜晚仍有生活', '冷湿的海风与“轻微孤独”很贴合'], tradeoff: '跨境交通与预算需要多留一点余量。', days: 3, tripDayOptions: [2, 3, 4], budget: '¥ 3,500–5,000', season: '10–12 月更接近清冷气质', image: baseImages.hakodate, coordinates: [46, 28], itinerary: itineraryFor('hakodate'), reminder: '静态编辑库 / 示例：交通、天气与营业时间请在出发前二次核验。', alternative: '日本小樽：更精致，也更容易遇到游客。' },
    { id: 'whitby', city: '惠特比', region: '北约克郡', country: '英国', role: 'unexpected', roleLabel: '更意外的选择', matchScore: 88, tagline: '冷峻海岸线，适合把一整天走成一部黑白电影。', atmosphere: ['悬崖', '海雾', '哥特', '长距离步行'], reasons: ['海岸步道给独处留下很大空间', '小镇尺度适合不设目标地走路', '夜晚有酒吧，但不会逼你社交'], tradeoff: '抵达成本较高，天气变化也更明显。', days: 3, tripDayOptions: [2, 3, 4], budget: '¥ 5,500–7,500', season: '秋冬的风更有画面感', image: baseImages.whitby, coordinates: [51, 48], itinerary: itineraryFor('whitby'), reminder: '静态编辑库 / 示例：跨国交通与签证要求需查看官方信息。', alternative: '爱尔兰戈尔韦：音乐更多，孤独感更轻。' },
    { id: 'porto', city: '波尔图', region: '北部大区', country: '葡萄牙', role: 'easy-to-reach', roleLabel: '更容易抵达的选择', matchScore: 81, tagline: '潮湿旧城里，酒馆把夜晚留给了慢慢认识的人。', atmosphere: ['旧城', '河岸', '酒馆', '石板路'], reasons: ['旧城步行密度高，随走随停', '酒馆文化提供“独处但不荒凉”的平衡', '生活成本相对更可控'], tradeoff: '热门街区会比你期待的更热闹。', days: 3, tripDayOptions: [2, 3, 4], budget: '¥ 3,800–5,500', season: '春秋温和，沿河风大', image: baseImages.porto, coordinates: [49, 67], itinerary: itineraryFor('porto'), reminder: '静态编辑库 / 示例：价格与开放状态仅作原型演示。', alternative: '西班牙拉科鲁尼亚：海风更强，人更少。' },
  ],
  summer: [
    { id: 'kamakura', city: '镰仓', region: '神奈川', country: '日本', role: 'best-match', roleLabel: '最像你描述的地方', matchScore: 95, tagline: '电车穿过海风，日常本身就是目的地。', atmosphere: ['电车', '海边', '旧房子', '食堂'], reasons: ['电车与海岸线自然构成慢节奏', '住宅街里有不被打扰的夏日片段', '旧房子与街角食堂比景点更值得停留'], tradeoff: '周末热门海岸会显得拥挤。', days: 3, tripDayOptions: [2, 3, 4], budget: '¥ 3,000–4,500', season: '6–9 月，夏日氛围最完整', image: baseImages.kamakura, coordinates: [46, 58], itinerary: itineraryFor('kamakura'), reminder: '静态编辑库 / 示例：季节与人流感受会随日期变化。', alternative: '日本逗子：更安静，但生活选择更少。' },
    { id: 'matsuyama', city: '松山', region: '爱媛', country: '日本', role: 'unexpected', roleLabel: '更意外的选择', matchScore: 86, tagline: '电车、温泉和海，在一座不急着被看见的城里。', atmosphere: ['路面电车', '温泉', '小城', '海风'], reasons: ['城市尺度更松弛，日常感比镰仓更强', '路面电车让移动本身变成风景', '温泉与海边让夏天有了收尾'], tradeoff: '与海的距离需要更主动地安排。', days: 3, tripDayOptions: [2, 3, 4], budget: '¥ 2,800–4,200', season: '4–10 月适合慢游', image: baseImages.matsuyama, coordinates: [35, 43], itinerary: itineraryFor('matsuyama'), reminder: '静态编辑库 / 示例：路线不替代实时导航。', alternative: '日本高松：更有艺术感，也更规划化。' },
    { id: 'dongshan', city: '东山岛', region: '漳州', country: '中国', role: 'easy-to-reach', roleLabel: '更容易抵达的选择', matchScore: 82, tagline: '海边旧厝与慢慢晒热的午后，近一点也可以很远。', atmosphere: ['海风', '旧厝', '渔港', '慢夏'], reasons: ['国内抵达门槛低，适合短暂离开', '海边村落保留了较多生活感', '租一辆车就能拥有很大的漫游自由'], tradeoff: '旺季海边与热门机位商业感会上升。', days: 3, tripDayOptions: [2, 3, 4], budget: '¥ 1,800–3,000', season: '5–6 月更舒适', image: baseImages.songyang, coordinates: [62, 72], itinerary: itineraryFor('dongshan'), reminder: '静态编辑库 / 示例：岛上交通与天气需出发前核验。', alternative: '福建平潭：海更开阔，但风也更大。' },
  ],
  domestic: [
    { id: 'songyang', city: '松阳', region: '丽水', country: '中国', role: 'best-match', roleLabel: '最像你描述的地方', matchScore: 93, tagline: '山路、茶烟和旧村落，把周末调成静音。', atmosphere: ['山水', '茶园', '旧村', '留白'], reasons: ['古村落之外仍有大量可以散步的山路', '茶空间提供了适合发呆的停留点', '从上海出发适合作为一次低压力周末'], tradeoff: '公共交通衔接有限，自驾更从容。', days: 2, tripDayOptions: [2, 3, 4], budget: '¥ 1,200–2,200', season: '春秋清润，夏季更适合早晚出门', image: baseImages.songyang, coordinates: [40, 44], itinerary: itineraryFor('songyang', 2), itineraryVariants: domesticItineraryVariantsFor('songyang'), reminder: '静态编辑库 / 示例：山路与天气请穿舒适鞋并实时确认。', alternative: '浙江宁海：抵达更简单，但古村体验更轻。' },
    { id: 'liyang', city: '南山竹海', region: '溧阳', country: '中国', role: 'unexpected', roleLabel: '更意外的选择', matchScore: 85, tagline: '竹林把视线收窄，心也跟着慢下来。', atmosphere: ['竹林', '温泉', '山谷', '安静'], reasons: ['自然景观足够集中，不需要赶路', '竹林步道能提供连续的低刺激体验', '适合把两天都过得简单一点'], tradeoff: '节假日景区周边会有明显人流。', days: 2, tripDayOptions: [2, 3, 4], budget: '¥ 1,000–1,800', season: '四季可去，雨后更清润', image: baseImages.liyang, coordinates: [57, 34], itinerary: itineraryFor('liyang', 2), itineraryVariants: domesticItineraryVariantsFor('liyang'), reminder: '静态编辑库 / 示例：景区开放状态需以官方信息为准。', alternative: '浙江安吉：竹林更大，商业配套也更多。' },
    { id: 'ninghai', city: '宁海', region: '宁波', country: '中国', role: 'easy-to-reach', roleLabel: '更容易抵达的选择', matchScore: 80, tagline: '海边与山间之间，留出一段不被安排的路。', atmosphere: ['海湾', '古道', '温泉', '茶'], reasons: ['从上海出发交通成本相对低', '古道与海湾可以在两天内轻松组合', '不依赖打卡点也能成立一段旅程'], tradeoff: '城市本身的惊喜感需要自己慢慢找。', days: 2, tripDayOptions: [2, 3, 4], budget: '¥ 900–1,600', season: '春秋最适合步行', image: baseImages.ninghai, coordinates: [64, 56], itinerary: itineraryFor('ninghai', 2), itineraryVariants: domesticItineraryVariantsFor('ninghai'), reminder: '静态编辑库 / 示例：交通班次与天气请出发前确认。', alternative: '浙江台州：街巷更有烟火气，但更热闹。' },
  ],
};

/**
 * Canonical WGS84 destination coordinates. The original card layout used
 * decorative coordinates; real-service requests must never use those values.
 * Map rendering already resolves the same centers in `data/geography.ts`.
 */
export const canonicalCoordinates: Record<string, [number, number]> = {
  hakodate: [140.728, 41.768], whitby: [-0.614, 54.487], porto: [-8.611, 41.149],
  kamakura: [139.55, 35.319], matsuyama: [132.766, 33.841], dongshan: [117.5, 23.72],
  songyang: [119.486, 28.449], liyang: [119.483, 31.427], ninghai: [121.431, 29.291],
};

Object.values(destinations).flat().forEach((destination) => {
  const coordinates = canonicalCoordinates[destination.id];
  if (coordinates) destination.coordinates = coordinates;
});
