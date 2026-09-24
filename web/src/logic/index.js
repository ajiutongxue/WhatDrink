// @ts-expect-error Vite aliases/prebundles the existing CommonJS modules.
import teaData from '@legacy/teaData';
// @ts-expect-error Vite aliases/prebundles the existing CommonJS modules.
import recommendation from '@legacy/recommend';
// @ts-expect-error Vite aliases/prebundles the local CommonJS keyword parser.
import keywordParser from '@legacy/keywordParser';
// @ts-expect-error Vite aliases/prebundles the existing CommonJS modules.
import teaMatch from '@legacy/teaMatch';
// @ts-expect-error Vite aliases/prebundles the existing CommonJS modules.
import historyOrder from '@legacy/historyOrder';
// @ts-expect-error Vite aliases/prebundles the existing UMD calendar.
import lunar from '@legacy/lunar';
import { getHistoryStats as summarizeHistory } from './historyStats.js';
import { getLunarSummary as summarizeLunarDate } from './lunarSummary.js';
export { openInventoryItem, consumeInventorySession, finishInventoryItem, deleteInventoryItem, listInventory, validateInventoryItem } from './inventory.js';
export function getHistoryStats(history, teaLibrary = teaData.TEAS, now = new Date()) {
  return summarizeHistory(history, teaLibrary, now, teaData.CAT_NAMES);
}

// Reuse the existing wx-independent recommendation, match, sort, and calendar
// implementations; only the parser keyword table is copied without wx/LLM/tracker.
export const TEAS = teaData.TEAS;
export const teaCatalog = teaData;
export const recommend = recommendation.recommend;
export const filterEligible = recommendation.filterEligible;
export const getIdealNature = recommendation.getIdealNature;
export const getTimeSlot = recommendation.getTimeSlot;
export const adjustNature = recommendation.adjustNature;
export const getConsecutiveBlockedTeaIds = recommendation.getConsecutiveBlockedTeaIds;
export const getActiveTemporaryAvoidTeaIds = recommendation.getActiveTemporaryAvoidTeaIds;
export const buildPreferenceContext = recommendation.buildPreferenceContext;
export const preferenceScoreForTea = recommendation.preferenceScoreForTea;
export const buildTwoStageCandidatePool = recommendation.buildTwoStageCandidatePool;
export const parseInput = keywordParser.parseInput;
export const matchTeaInput = teaMatch.matchTeaInput;
export const repairCustomHistoryLinks = teaMatch.repairCustomHistoryLinks;
export const sortHistoryForDisplay = historyOrder.sortHistoryForDisplay;
export const lunarCalendar = lunar;

export function getLunarSummary(date) {
  return summarizeLunarDate(date, lunar);
}
