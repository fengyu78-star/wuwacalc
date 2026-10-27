require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const data = JSON.parse(fs.readFileSync('/tmp/brush-result-8.json', 'utf8'));
// 真实模板新效果：YQLSEV（菲比6链重击星辉 + 漂泊者衍射共鸣效率）
const CODES = ['MC-YQLSEV'];
(async () => {
  for (const code of CODES) {
    const v = data[code];
    if (!v || v.err) { console.log(code, 'skip'); continue; }
    const { data: updated, error } = await supabase
      .from('schemes')
      .update({ summary: v.newSummary })
      .eq('share_code', code)
      .select('share_code, summary');
    if (error) console.log(code, 'ERR', error.message);
    else console.log(code, 'updated, teamDps =', updated && updated[0] && updated[0].summary.teamDps);
  }
  process.exit(0);
})();
