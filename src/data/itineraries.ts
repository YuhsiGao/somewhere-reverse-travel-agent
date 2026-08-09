import type { DayPlan, GeoPoint, PoiCategory, TravelDataSource, TravelMode } from '../types';

const UPDATED_AT = '2026-08-03';
const STATIC_NOTE = '静态编辑库 / 示例数据：名称与坐标用于产品演示，未核验实时营业、预约、封路或交通状态。';

type PoiSeed = [name: string, category: PoiCategory, coordinates: GeoPoint, stayMinutes: number, whyItFits: string];
type LegSeed = [mode: TravelMode, distanceKm: number, durationMinutes: number, note?: string];
type DaySeed = { theme: string; intro: string; pois: PoiSeed[]; legs: LegSeed[] };

function sourceFor(name: string): TravelDataSource {
  return {
    label: `静态编辑库 · ${name}（示例）`,
    url: `https://www.openstreetmap.org/search?query=${encodeURIComponent(name)}`,
    status: 'static-editorial-demo',
    updatedAt: UPDATED_AT,
    note: STATIC_NOTE,
  };
}

function navigationUrl(from: GeoPoint, to: GeoPoint, mode: TravelMode) {
  const engine = mode === 'walk' ? 'fossgis_osrm_foot' : mode === 'bike' ? 'fossgis_osrm_bike' : 'fossgis_osrm_car';
  return `https://www.openstreetmap.org/directions?engine=${engine}&route=${from[1]}%2C${from[0]}%3B${to[1]}%2C${to[0]}`;
}

function buildDay(day: number, seed: DaySeed): DayPlan {
  const pois = seed.pois.map(([name, category, coordinates, stayMinutes, whyItFits], index) => ({
    id: `day-${day}-poi-${index + 1}`,
    name,
    category,
    coordinates,
    stayMinutes,
    whyItFits,
    operatingRisk: '静态示例，不代表实时营业、预约、票务、天气或道路通行；出发前请通过官方渠道确认。',
    source: sourceFor(name),
  }));
  const travelLegs = seed.legs.map(([mode, distanceKm, durationMinutes, note], index) => ({
    id: `day-${day}-leg-${index + 1}`,
    fromPoiId: pois[index].id,
    toPoiId: pois[index + 1].id,
    mode,
    distanceKm,
    durationMinutes,
    navigationUrl: navigationUrl(pois[index].coordinates, pois[index + 1].coordinates, mode),
    note: note ?? '估算移动段，仅用于演示；请以地图服务的实时导航为准。',
  }));
  return {
    day,
    theme: seed.theme,
    intro: seed.intro,
    moments: pois.map((poi) => `${poi.name} · 约 ${poi.stayMinutes} 分钟`),
    pois,
    travelLegs,
    dataStatus: 'static-editorial-demo',
    lastUpdated: UPDATED_AT,
  };
}

const seedPlans: Record<string, DaySeed[]> = {
  hakodate: [
    { theme: '把港口走熟', intro: '从仓库与坡道开始，让港口的风决定速度。', pois: [['金森红砖仓库', 'harbor', [140.716, 41.763], 60, '港口尺度紧凑，适合先用步行进入城市。'], ['元町街区', 'neighborhood', [140.708, 41.759], 90, '旧建筑与坡道提供慢走的层次。'], ['八幡坂', 'viewpoint', [140.707, 41.758], 40, '把海港留在视线尽头，适合收束第一天。']], legs: [['walk', 0.9, 15], ['walk', 0.2, 5]] },
    { theme: '在旧城里慢下来', intro: '市场、旧街和山顶之间，安排一条有停顿的线。', pois: [['函馆朝市', 'market', [140.727, 41.773], 60, '适合用日常感而不是打卡开始早晨。'], ['大门横丁', 'food', [140.73, 41.771], 75, '为夜晚保留一顿不赶时间的饭。'], ['函馆山缆车站', 'transit', [140.704, 41.751], 80, '示例中作为黄昏看港湾的停靠点。']], legs: [['walk', 0.4, 7], ['taxi', 2.8, 15]] },
    { theme: '留一段海边空白', intro: '最后一天只放三个轻量停靠点。', pois: [['五棱郭公园', 'park', [140.756, 41.795], 75, '水边与绿地能让节奏自然变慢。'], ['五棱郭塔周边', 'viewpoint', [140.752, 41.796], 45, '用高处确认城市尺度。'], ['汤之川海边', 'beach', [140.786, 41.782], 60, '留给不设任务的散步。']], legs: [['walk', 0.4, 6], ['taxi', 4.2, 18]] },
  ],
  whitby: [
    { theme: '把海岸线交给风', intro: '用长距离步行而不是景点清单认识海边。', pois: [['Whitby Harbour', 'harbor', [-0.613, 54.486], 50, '港口是小镇生活与海风相遇的起点。'], ['199 Steps', 'walk', [-0.615, 54.489], 35, '用一段坡度转换视线与心情。'], ['Whitby Abbey', 'viewpoint', [-0.614, 54.491], 75, '高处视野适合留出独处的空间。']], legs: [['walk', 0.4, 8], ['walk', 0.5, 15]] },
    { theme: '沿坡道进入旧镇', intro: '在街巷、市场与海堤之间松散移动。', pois: [['Whitby Market Place', 'market', [-0.616, 54.487], 45, '从日常尺度进入旧镇。'], ['Church Street', 'neighborhood', [-0.615, 54.488], 70, '适合不设目的地地闲走。'], ['West Pier', 'walk', [-0.614, 54.484], 55, '海堤能把人群和视线一起拉开。']], legs: [['walk', 0.2, 4], ['walk', 0.7, 12]] },
    { theme: '在灯亮之前回到住处', intro: '最后一天安排得更短，给天气留余地。', pois: [['Pannett Park', 'park', [-0.618, 54.486], 50, '安静绿地适合避开海边风。'], ['Whitby Museum', 'museum', [-0.618, 54.486], 60, '为阴雨天准备的室内停靠点。'], ['Tate Hill Beach', 'beach', [-0.616, 54.489], 40, '用海边短停结束行程。']], legs: [['walk', 0.1, 2], ['walk', 0.6, 10]] },
  ],
  porto: [
    { theme: '沿杜罗河走走', intro: '沿河走得足够慢，旧城会自己出现。', pois: [['Ribeira Square', 'neighborhood', [-8.611, 41.141], 60, '河岸密度高，适合随走随停。'], ['Dom Luís I Bridge', 'walk', [-8.609, 41.14], 35, '过桥让河岸与城市层次变得清楚。'], ['Jardim do Morro', 'park', [-8.607, 41.138], 65, '山坡公园适合留一段观看时间。']], legs: [['walk', 0.3, 6], ['walk', 0.4, 8]] },
    { theme: '从市场走进旧街', intro: '给市场、书店和街巷各留一点时间。', pois: [['Bolhão Market', 'market', [-8.606, 41.149], 65, '用本地日常打破游客节奏。'], ['Livraria Lello 周边', 'neighborhood', [-8.614, 41.147], 45, '只作为街区停留点，不承诺入内。'], ['Clérigos Tower 周边', 'viewpoint', [-8.615, 41.146], 55, '适合用高低落差继续慢走。']], legs: [['walk', 0.8, 14], ['walk', 0.2, 4]] },
    { theme: '找一张临窗的桌子', intro: '最后一天从花园到河边，不追赶任何景点。', pois: [['Crystal Palace Gardens', 'park', [-8.622, 41.148], 70, '绿地可以给石板路旅行一次缓冲。'], ['Miragaia', 'neighborhood', [-8.619, 41.145], 55, '沿河街区适合缓慢下降。'], ['Cais das Pedras', 'harbor', [-8.625, 41.147], 50, '在水边收尾，保留临时改变计划的空间。']], legs: [['walk', 0.5, 9], ['walk', 0.7, 12]] },
  ],
  kamakura: [
    { theme: '从一站电车开始', intro: '让电车和步行共同决定第一天的速度。', pois: [['江之电镰仓站', 'transit', [139.486, 35.318], 25, '把移动本身变成夏日体验的一部分。'], ['由比滨海滩', 'beach', [139.539, 35.307], 70, '海边停留不需要附带打卡任务。'], ['长谷街区', 'neighborhood', [139.536, 35.312], 60, '住宅感街巷适合找一顿慢晚餐。']], legs: [['public-transit', 3.6, 18], ['walk', 0.7, 12]] },
    { theme: '去海边坐一会儿', intro: '寺院、海滩和咖啡停靠点保持轻量。', pois: [['长谷寺周边', 'temple', [139.532, 35.314], 60, '山坡与海景能让节奏自然放缓。'], ['稻村崎公园', 'park', [139.514, 35.304], 65, '适合看海，也适合什么都不做。'], ['极乐寺站周边', 'transit', [139.51, 35.311], 40, '老站与住宅街提供安静的过渡。']], legs: [['public-transit', 2.0, 10], ['walk', 0.8, 13]] },
    { theme: '在住宅街找晚餐', intro: '把最后一天留给街区、市场和黄昏。', pois: [['镰仓小町通周边', 'neighborhood', [139.551, 35.32], 55, '仅作为街区漫步示例，热门时请调整。'], ['镰仓农协连卖所周边', 'market', [139.552, 35.319], 35, '用日常采购感完成一次短停。'], ['材木座海岸', 'beach', [139.555, 35.305], 65, '相对宽阔的海边适合告别前散步。']], legs: [['walk', 0.3, 5], ['bike', 2.0, 15]] },
  ],
  matsuyama: [
    { theme: '坐电车看城市', intro: '第一天让路面电车连接城与温泉街。', pois: [['大街道商店街周边', 'neighborhood', [132.768, 33.841], 60, '日常街区适合慢慢进入城市。'], ['松山城缆车站', 'transit', [132.766, 33.847], 60, '示例中作为高处与城市的连接点。'], ['道后温泉本馆周边', 'hot-spring', [132.786, 33.851], 75, '温泉街有适合夜晚慢走的尺度。']], legs: [['walk', 0.8, 13], ['public-transit', 3.1, 18]] },
    { theme: '泡一场午后温泉', intro: '在温泉、街巷和公园之间保留缓冲。', pois: [['道后公园', 'park', [132.787, 33.848], 55, '绿地能减弱温泉街的人流感。'], ['伊佐尔波神社周边', 'temple', [132.787, 33.855], 45, '坡道与树荫适合短距离步行。'], ['飞鸟乃汤泉周边', 'hot-spring', [132.786, 33.851], 70, '作为静态示例中的放松停靠点。']], legs: [['walk', 0.7, 12], ['walk', 0.6, 10]] },
    { theme: '去港边等一班船', intro: '最后一天让电车、港口和海风串起来。', pois: [['三津滨站周边', 'transit', [132.712, 33.861], 25, '将移动变成一段轻松的城市观察。'], ['三津滨港', 'harbor', [132.709, 33.867], 60, '港口的生活感比明确景点更重要。'], ['梅津寺海岸', 'beach', [132.72, 33.873], 55, '用一段海岸步行收尾。']], legs: [['walk', 0.8, 13], ['public-transit', 2.1, 12]] },
  ],
  dongshan: [
    { theme: '在渔港醒来', intro: '从海湾、老街和港口慢慢铺开第一天。', pois: [['南门湾', 'beach', [117.504, 23.726], 70, '海湾尺度适合早晨散步与停坐。'], ['铜陵老街', 'neighborhood', [117.5, 23.726], 60, '旧厝和小巷能留住生活感。'], ['铜陵渔港', 'harbor', [117.497, 23.725], 45, '渔港适合用来观察而不是赶行程。']], legs: [['walk', 0.5, 8], ['walk', 0.4, 7]] },
    { theme: '沿旧厝慢慢走', intro: '村落和海边之间，用短距离移动保持松弛。', pois: [['苏峰山环岛路观景点', 'viewpoint', [117.515, 23.708], 55, '海岸线提供开阔但不急迫的视野。'], ['澳角村', 'village', [117.495, 23.694], 75, '村落尺度适合放慢步调。'], ['金銮湾', 'beach', [117.475, 23.704], 60, '为日落前留一个不需要消费的停靠点。']], legs: [['drive', 3.2, 12], ['drive', 4.5, 15]] },
    { theme: '看一场不必打卡的日落', intro: '最后一天选择最少的点，让海风占据更多时间。', pois: [['马銮湾', 'beach', [117.486, 23.73], 65, '海边空白比固定活动更符合旅行主题。'], ['风动石景区周边', 'walk', [117.503, 23.728], 50, '作为靠近海湾的步行节点。'], ['东山关帝庙周边', 'temple', [117.501, 23.727], 35, '在老街边收束行程。']], legs: [['drive', 2.4, 10], ['walk', 0.3, 5]] },
  ],
  songyang: [
    { theme: '走进茶山', intro: '茶园、村落与溪边用低密度移动串起。', pois: [['大木山茶园', 'tea', [119.467, 28.449], 80, '连片茶山适合把视线和呼吸一起放慢。'], ['松阳老街', 'neighborhood', [119.484, 28.449], 60, '保留一段日常街巷的缓冲。'], ['松阴溪沿岸', 'walk', [119.486, 28.452], 50, '溪边短走能避免把一天排得过满。']], legs: [['drive', 2.0, 10], ['walk', 0.5, 8]] },
    { theme: '把下午留给一盏茶', intro: '古村与茶空间之间只安排必要移动。', pois: [['杨家堂村', 'village', [119.458, 28.493], 85, '层叠村落与山景适合低刺激漫步。'], ['平田村', 'village', [119.458, 28.477], 65, '留出村中散步和停坐的时间。'], ['松庄村', 'village', [119.437, 28.476], 60, '将第二天下午交给更安静的山村。']], legs: [['drive', 2.0, 9], ['drive', 3.2, 12]] },
    { theme: '清晨看村落醒来', intro: '第三天控制在三个轻量节点，方便返程。', pois: [['陈家铺村', 'village', [119.559, 28.434], 75, '山村视野适合在清晨慢慢展开。'], ['松阳博物馆周边', 'museum', [119.484, 28.45], 50, '用室内文化点给行程一个平稳收尾。'], ['松阴溪绿道', 'walk', [119.488, 28.448], 45, '返程前留一段平缓散步。']], legs: [['drive', 9.0, 23], ['walk', 0.6, 9]] },
    { theme: '把山谷留作延长日', intro: '四天版本增加一个安静山谷日，不与返程日挤在一起。', pois: [['石仓古民居周边', 'village', [119.517, 28.399], 70, '用更偏离主线的村落延长留白。'], ['横坑村周边', 'village', [119.534, 28.418], 60, '山谷村路适合慢走而非赶点。'], ['松阳山谷观景路段', 'viewpoint', [119.542, 28.423], 40, '作为静态示例中的短停靠点。']], legs: [['drive', 3.1, 12], ['drive', 1.6, 7]] },
  ],
  liyang: [
    { theme: '穿过一片竹林', intro: '第一天集中在竹海，移动距离保持克制。', pois: [['南山竹海入口周边', 'walk', [119.462, 31.35], 45, '用步行进入竹林，让感官慢下来。'], ['静湖', 'park', [119.465, 31.347], 55, '水面与竹林提供低刺激停留。'], ['鸡鸣村周边', 'village', [119.469, 31.343], 60, '村落节点适合安排一顿简单午饭。']], legs: [['walk', 0.6, 10], ['walk', 0.8, 14]] },
    { theme: '在温泉边放空', intro: '第二天把湖边、温泉与村路作为三个停靠点。', pois: [['天目湖山水园周边', 'park', [119.495, 31.342], 65, '湖边适合松散步行与放空。'], ['御水温泉周边', 'hot-spring', [119.466, 31.348], 75, '仅作静态示例停靠点，需自行核验预约。'], ['李家园村周边', 'village', [119.48, 31.354], 50, '在更小的村路里缓冲人流。']], legs: [['drive', 4.3, 14], ['drive', 2.2, 9]] },
    { theme: '找一条村路散步', intro: '第三天轻走、喝茶、返程前不再塞进景点。', pois: [['溧阳博物馆周边', 'museum', [119.488, 31.425], 50, '城市边缘的文化点适合雨天替代。'], ['燕山公园', 'park', [119.481, 31.424], 55, '靠近城区，方便留出返程余量。'], ['溧阳老城区街巷', 'neighborhood', [119.484, 31.418], 45, '把最后的时间交给简单散步。']], legs: [['walk', 0.7, 11], ['walk', 0.8, 13]] },
    { theme: '给湖边多一天', intro: '四天版本把更多时间给湖岸与低强度步行。', pois: [['天目湖湖岸步道', 'walk', [119.505, 31.339], 70, '延长日只保留一段低强度步行。'], ['桂林村周边', 'village', [119.504, 31.354], 60, '村路适合在午后慢慢经过。'], ['天目湖观景平台周边', 'viewpoint', [119.5, 31.348], 40, '用湖面视野收束第四天。']], legs: [['walk', 1.8, 28], ['walk', 0.9, 15]] },
  ],
  ninghai: [
    { theme: '沿海湾散步', intro: '先让海湾和村路把周末从城市里带出来。', pois: [['强蛟群岛码头周边', 'harbor', [121.47, 29.28], 55, '港湾边能快速切换到更低的节奏。'], ['强蛟镇海岸', 'walk', [121.467, 29.276], 60, '适合没有明确目的地的短距离步行。'], ['宁海湾湿地周边', 'park', [121.462, 29.271], 50, '水边与湿地让视野保持开阔。']], legs: [['walk', 0.6, 10], ['walk', 0.8, 13]] },
    { theme: '走一段古道', intro: '古镇、山路和溪边之间，用自驾控制体力。', pois: [['前童古镇', 'village', [121.306, 29.358], 80, '巷道与水系适合慢走，而非赶点。'], ['梁皇山步道入口周边', 'walk', [121.338, 29.312], 70, '只取一小段步道，给体力留余地。'], ['天明山温泉周边', 'hot-spring', [121.334, 29.303], 65, '作为放松停靠点，需出发前核验。']], legs: [['drive', 7.2, 18], ['drive', 2.1, 8]] },
    { theme: '在温泉里结束周末', intro: '第三天靠近城区，确保可从容返程。', pois: [['宁海西门城楼周边', 'neighborhood', [121.43, 29.294], 45, '旧城街区适合作为轻量起点。'], ['柔石公园', 'park', [121.427, 29.29], 55, '城区绿地能减缓返程前的节奏。'], ['跃龙山公园', 'park', [121.434, 29.298], 60, '爬升不高，适合作为最后一段散步。']], legs: [['walk', 0.5, 8], ['walk', 0.9, 15]] },
    { theme: '海与石窟的加时日', intro: '四天版本为沿海停留加一天，避免与古镇日抢时间。', pois: [['伍山石窟周边', 'walk', [121.62, 29.321], 70, '岩壁与步道给行程增加不同的地貌层次。'], ['长街镇海岸周边', 'beach', [121.61, 29.29], 60, '海边留白适合放在延长日。'], ['宁海湾观景点', 'viewpoint', [121.54, 29.278], 45, '以开阔水面作为第四天收尾。']], legs: [['drive', 4.0, 14], ['drive', 8.4, 20]] },
  ],
};

export function itineraryFor(destinationId: string, dayCount?: 2 | 3 | 4): DayPlan[] {
  const days = seedPlans[destinationId];
  if (!days) throw new Error(`Missing static itinerary demo data for ${destinationId}`);
  return days.slice(0, dayCount).map((day, index) => buildDay(index + 1, day));
}

export function domesticItineraryVariantsFor(destinationId: string): Record<2 | 3 | 4, DayPlan[]> {
  return { 2: itineraryFor(destinationId, 2), 3: itineraryFor(destinationId, 3), 4: itineraryFor(destinationId, 4) };
}

export const STATIC_TRAVEL_DATA_NOTICE = STATIC_NOTE;
