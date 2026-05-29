const fs = require('fs');
const path = require('path');

const TRACKER_FILE = path.join(__dirname, '../data/ai_cost_tracker.json');

const INPUT_PRICE = Number(process.env.AI_INPUT_PRICE_PER_MILLION || 0.15) / 1_000_000;
const OUTPUT_PRICE = Number(process.env.AI_OUTPUT_PRICE_PER_MILLION || 0.60) / 1_000_000;
const DEFAULT_BUDGET_USD = Number(process.env.AI_BUDGET_USD || 0.50);

function read() {
  try {
    if (fs.existsSync(TRACKER_FILE)) return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf-8'));
  } catch {}
  return { total_cost_usd: 0, total_input_tokens: 0, total_output_tokens: 0, call_count: 0 };
}

function write(data) {
  fs.mkdirSync(path.dirname(TRACKER_FILE), { recursive: true });
  fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2));
}

function getUsage() {
  return read();
}

function recordUsage(inputTokens, outputTokens) {
  const tracker = read();
  const callCost = (inputTokens * INPUT_PRICE) + (outputTokens * OUTPUT_PRICE);
  tracker.total_input_tokens  += inputTokens;
  tracker.total_output_tokens += outputTokens;
  tracker.total_cost_usd      += callCost;
  tracker.call_count          += 1;
  tracker.last_updated         = new Date().toISOString();
  write(tracker);
  console.log(`[costTracker] AI call cost: $${callCost.toFixed(5)} | Total spent: $${tracker.total_cost_usd.toFixed(5)} / $${DEFAULT_BUDGET_USD.toFixed(5)}`);
  return { callCost, totalCost: tracker.total_cost_usd };
}

function isOverBudget(limitUsd = 0.50) {
  const { total_cost_usd } = read();
  return total_cost_usd >= limitUsd;
}

function getRemainingBudget(limitUsd = 0.50) {
  const { total_cost_usd } = read();
  return Math.max(0, limitUsd - total_cost_usd);
}

module.exports = { getUsage, recordUsage, isOverBudget, getRemainingBudget };
