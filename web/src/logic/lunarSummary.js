export function getLunarSummary(date, lunarCalendar) {
  const value = lunarCalendar.Lunar.fromDate(date);
  return {
    lunarText: value.toString(),
    jieQi: value.getJieQi() || null,
    solarDate: value.getSolar().toYmd(),
  };
}
