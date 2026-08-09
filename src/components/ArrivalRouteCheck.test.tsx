import { describe, expect, it } from 'vitest';
import { arrivalRouteState, RAILWAY_OFFICIAL_SEARCH_URL } from './ArrivalRouteCheck';

describe('arrival route availability', () => {
  it('only enables a real road check for a known departure and self-drive', () => {
    expect(arrivalRouteState('上海', 'drive')).toBe('ready');
    expect(arrivalRouteState('暂不确定', 'drive')).toBe('needs-departure');
    expect(arrivalRouteState('上海', 'undecided')).toBe('needs-mode');
    expect(arrivalRouteState('上海', 'rail')).toBe('unsupported-mode');
  });
  it('keeps rail schedule lookup outside the product data boundary', () => expect(RAILWAY_OFFICIAL_SEARCH_URL).toBe('https://www.12306.cn/index/'));
});
