const fs = require('node:fs');
const path = require('node:path');
const { TEAS } = require('../utils/teaData.js');
const knowledgeCatalog = require('../data/teaKnowledgeCatalog.js');

const outputPath = path.resolve(__dirname, '../server/seed.json');
const seed = {
  schemaVersion: 1,
  teas: TEAS,
  knowledgeCatalog,
};

function validateSeed() {
  const teaIds = seed.teas.map((tea) => tea.id);
  const withheld = new Set(knowledgeCatalog.withheldTeaIds);
  const knowledgeIds = knowledgeCatalog.teas.map((tea) => tea.teaId);
  const expectedKnowledgeIds = teaIds.filter((id) => !withheld.has(id));

  if (seed.teas.length !== 89 || new Set(teaIds).size !== 89) {
    throw new Error(`Expected 89 unique teas, got ${seed.teas.length}`);
  }
  if (knowledgeCatalog.expectedTeaCount !== 89 || knowledgeIds.length !== 86) {
    throw new Error('Knowledge catalog must contain 86 complete profiles for 89 teas');
  }
  if (withheld.size !== 3 || [...withheld].some((id) => !teaIds.includes(id))) {
    throw new Error('Knowledge catalog must withhold exactly three known tea IDs');
  }
  if (JSON.stringify([...knowledgeIds].sort((a, b) => a - b)) !== JSON.stringify(expectedKnowledgeIds.sort((a, b) => a - b))) {
    throw new Error('Knowledge profile IDs do not match the non-withheld tea IDs');
  }
}

validateSeed();
const content = `${JSON.stringify(seed, null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== content) {
    console.error('PWA seed is stale. Run: node scripts/generate-pwa-seed.js');
    process.exitCode = 1;
  } else {
    console.log('PWA seed is current: 89 teas, 86 complete profiles, 3 withheld.');
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`Generated ${path.relative(process.cwd(), outputPath)}: 89 teas, 86 complete profiles, 3 withheld.`);
}
