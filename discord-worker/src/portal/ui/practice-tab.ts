export const practiceTabHtml = `
<section class="panel" id="practice-panel" role="tabpanel" aria-labelledby="practice-tab" hidden>
  <div class="practice-grid">
    <section class="practice-section">
      <div class="practice-heading"><div><h2>練習を作成</h2><p>参加メンバー・組み合わせ方式・使用札をまとめて設定します。</p></div></div>
      <form id="practice-session-form" class="practice-form">
        <div class="practice-fields">
          <label>練習日<input type="date" name="practiceDate" required></label>
          <label>練習名<input name="title" maxlength="100" value="通常練習" required></label>
          <label>会場<input name="location" maxlength="100" placeholder="任意"></label>
          <label>組み合わせ<select name="pairingMode" required><option value="near_grade">近い級中心</option><option value="mixed">ごちゃ混ぜ</option></select></label>
          <label>札組<select name="cardScheme" required><option value="number_ones">札番号の1の位</option><option value="number_tens">札番号の10の位</option><option value="hiragana">ひらがな</option><option value="katakana">カタカナ</option><option value="kanji">漢数字</option><option value="alphabet">アルファベット</option></select></label>
        </div>
        <fieldset class="member-picker"><legend>参加メンバー</legend><div id="practice-member-list" class="member-picker-list"></div></fieldset>
        <div class="practice-actions"><span class="message" id="practice-session-message"></span><button class="practice-primary" type="submit">練習を作成</button></div>
      </form>
    </section>
    <section class="practice-section">
      <div class="practice-heading"><div><h2>練習一覧・組み合わせ</h2><p>作成者が次の試合を生成し、参加者が自分の結果を記録できます。</p></div></div>
      <div id="practice-session-list" class="practice-session-list"></div>
    </section>
    <section class="practice-section">
      <div class="practice-heading"><div><h2>外部練習会の結果を追加</h2><p>外部の相手との対戦を自分の記録へ追加します。</p></div></div>
      <form id="external-match-form" class="practice-form">
        <div class="practice-fields">
          <label>対戦日<input type="date" name="playedOn" required></label>
          <label>練習会名<input name="eventName" maxlength="100" required></label>
          <label>対戦相手<input name="opponentName" maxlength="100" required></label>
          <label>所属<input name="opponentAffiliation" maxlength="100"></label>
          <label>相手の級<select name="opponentGrade" required><option value="A">A級</option><option value="B">B級</option><option value="C">C級</option><option value="D">D級</option><option value="E">E級</option><option value="F">F級</option><option value="beginner">初心者</option></select></label>
          <label>勝敗<select name="outcome" required><option value="win">勝ち</option><option value="loss">負け</option></select></label>
          <label>枚数差<input type="number" name="scoreDifference" min="0" max="50" inputmode="numeric"></label>
          <label>備考<input name="note" maxlength="500"></label>
        </div>
        <div class="practice-actions"><span class="message" id="external-match-message"></span><button class="practice-primary" type="submit">結果を追加</button></div>
      </form>
    </section>
    <section class="practice-section">
      <div class="practice-heading"><div><h2>自分の対戦記録</h2><p>大会・サークル内練習・外部練習会をまとめて集計します。</p></div></div>
      <div id="practice-statistics"></div>
      <div id="practice-record-list" class="practice-record-list"></div>
    </section>
  </div>
</section>`;

export const practiceTabScript = String.raw`
const practiceSourceLabels={internal_practice:'サークル内練習',external_practice:'外部練習会',tournament:'大会'};
const practiceModeLabels={near_grade:'近い級中心',mixed:'ごちゃ混ぜ'};
function renderPracticeMembers(){const root=document.querySelector('#practice-member-list');if(!practice||root.childElementCount)return;root.innerHTML=practice.members.map(member=>'<label class="member-choice"><input type="checkbox" name="memberIds" value="'+esc(member.member_id)+'"><span><strong>'+esc(member.display_name)+'</strong><small>'+esc(grade(member.grade))+'</small></span></label>').join('')}
function practiceCards(item){if(!item.card_selection)return '<span class="empty">未抽選</span>';return '<strong>'+esc(item.card_selection.labels.join('・'))+'</strong><small>'+esc(item.card_selection.scheme==='number_ones'?'札番号の1の位':item.card_selection.scheme==='number_tens'?'札番号の10の位':item.card_selection.scheme==='hiragana'?'ひらがな':item.card_selection.scheme==='katakana'?'カタカナ':item.card_selection.scheme==='kanji'?'漢数字':'アルファベット')+'</small>'}
function practiceMatchRow(match){if(match.status==='bye')return '<li class="practice-match bye"><span>休み</span><strong>'+esc(match.player1_name)+'</strong></li>';const completed=match.status==='completed';const result=completed?'<span class="practice-result">'+esc(match.winner_member_id===match.player1_member_id?match.player1_name:match.player2_name)+' 勝'+(match.score_difference!=null?'（'+esc(match.score_difference)+'枚）':'')+'</span>':'';const canRecord=practice.current_member_id===match.player1_member_id||practice.current_member_id===match.player2_member_id;const controls=!completed&&canRecord?'<span class="practice-result-controls"><input class="practice-score" type="number" min="0" max="50" inputmode="numeric" placeholder="枚数差"><button type="button" class="practice-win" data-match="'+esc(match.match_id)+'" data-winner="'+esc(match.player1_member_id)+'">'+esc(match.player1_name)+'勝</button><button type="button" class="practice-win" data-match="'+esc(match.match_id)+'" data-winner="'+esc(match.player2_member_id)+'">'+esc(match.player2_name)+'勝</button></span>':'';return '<li class="practice-match"><span>'+esc(match.player1_name)+' — '+esc(match.player2_name)+'</span>'+result+controls+'</li>'}
function renderPracticeSessions(){const root=document.querySelector('#practice-session-list');if(!practice)return;if(!practice.sessions.length){root.innerHTML='<div class="empty">練習はまだ作成されていません。</div>';return}root.innerHTML=practice.sessions.map(item=>{const rounds=new Map();item.matches.forEach(match=>{const list=rounds.get(match.round_number)||[];list.push(match);rounds.set(match.round_number,list)});const roundHtml=[...rounds.entries()].sort((a,b)=>b[0]-a[0]).map(([number,matches])=>'<div class="practice-round"><h4>第'+esc(number)+'試合</h4><ul>'+matches.map(practiceMatchRow).join('')+'</ul></div>').join('');const participants=item.participants.map(person=>'<span>'+esc(person.display_name)+'<small>'+esc(grade(person.grade))+'</small></span>').join('');const generate=item.created_by_member_id===practice.current_member_id?'<button type="button" class="practice-generate" data-session="'+esc(item.session_id)+'">次の組み合わせを生成</button>':'';return '<article class="practice-session-card"><div class="card-head"><div><h3>'+esc(item.title)+'</h3><p>'+esc(eventDate(item.practice_date))+(item.location?'・'+esc(item.location):'')+'</p></div><span class="status">'+esc(practiceModeLabels[item.pairing_mode])+'</span></div><div class="practice-card-selection"><span>使用札</span>'+practiceCards(item)+'</div><div class="practice-member-chips">'+participants+'</div><div class="practice-rounds">'+(roundHtml||'<p class="empty">組み合わせはまだありません。</p>')+'</div><div class="practice-actions">'+generate+'</div></article>'}).join('');root.querySelectorAll('.practice-generate').forEach(button=>button.addEventListener('click',generatePracticeRound));root.querySelectorAll('.practice-win').forEach(button=>button.addEventListener('click',savePracticeResult))}
function statisticTable(rows,label){if(!rows.length)return '<p class="empty">'+esc(label)+'の記録はありません。</p>';return '<div class="practice-table-wrap"><table class="practice-table"><thead><tr><th>'+esc(label)+'</th><th>対戦</th><th>勝</th><th>負</th><th>勝率</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+esc(row.label)+(row.affiliation?' <small>'+esc(row.affiliation)+'</small>':'')+'</td><td>'+esc(row.matches)+'</td><td>'+esc(row.wins)+'</td><td>'+esc(row.losses)+'</td><td>'+esc(row.winRate.toFixed(1))+'%</td></tr>').join('')+'</tbody></table></div>'}
function renderPracticeStatistics(){if(!practice)return;const stats=practice.statistics;const html='<div class="practice-summary"><div><small>通算対戦</small><strong>'+esc(stats.overall.matches)+'</strong></div><div><small>勝</small><strong>'+esc(stats.overall.wins)+'</strong></div><div><small>負</small><strong>'+esc(stats.overall.losses)+'</strong></div><div><small>勝率</small><strong>'+esc(stats.overall.winRate.toFixed(1))+'%</strong></div></div><div class="practice-stat-grid"><section><h3>級ごとの成績</h3>'+statisticTable(stats.byGrade,'相手の級')+'</section><section><h3>相手ごとの成績</h3>'+statisticTable(stats.byOpponent,'対戦相手')+'</section></div>';document.querySelectorAll('#practice-statistics,#profile-practice-statistics').forEach(root=>root.innerHTML=html)}
function renderPracticeRecords(){if(!practice)return;const rows=practice.records.slice(0,50);const html=!rows.length?'<p class="empty">対戦記録はまだありません。</p>':'<h3>最近の対戦</h3><div class="practice-table-wrap"><table class="practice-table"><thead><tr><th>日付</th><th>種別</th><th>相手</th><th>級</th><th>結果</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+esc(row.playedOn)+'</td><td>'+esc(practiceSourceLabels[row.source])+'</td><td>'+esc(row.opponentName)+'</td><td>'+esc(grade(row.opponentGrade))+'</td><td class="'+(row.outcome==='win'?'practice-win-mark':'practice-loss-mark')+'">'+(row.outcome==='win'?'○':'×')+(row.scoreDifference!=null?esc(row.scoreDifference):'')+'</td></tr>').join('')+'</tbody></table></div>';document.querySelectorAll('#practice-record-list,#profile-practice-record-list').forEach(root=>root.innerHTML=html)}
function renderPractice(){if(!practice)return;renderPracticeMembers();renderPracticeSessions();renderPracticeStatistics();renderPracticeRecords()}
function updatePractice(data){practice=data.practice||data;renderPractice()}
async function createPracticeSession(event){event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type="submit"]');const message=document.querySelector('#practice-session-message');const fields=new FormData(form);const memberIds=fields.getAll('memberIds');button.disabled=true;message.textContent='作成しています…';try{const data=await api('/api/practice/sessions',{method:'POST',body:JSON.stringify({practiceDate:fields.get('practiceDate'),title:fields.get('title'),location:fields.get('location'),pairingMode:fields.get('pairingMode'),cardScheme:fields.get('cardScheme'),memberIds})});updatePractice(data);form.querySelectorAll('input[name="memberIds"]').forEach(input=>input.checked=false);message.textContent='';showToast('練習を作成しました。')}catch(error){message.textContent=error.message;message.classList.add('error')}finally{button.disabled=false}}
async function generatePracticeRound(event){const button=event.currentTarget;button.disabled=true;try{const data=await api('/api/practice/sessions/'+encodeURIComponent(button.dataset.session)+'/rounds',{method:'POST'});updatePractice(data);showToast('組み合わせを生成しました。')}catch(error){button.disabled=false;showToast(error.message)}}
async function savePracticeResult(event){const button=event.currentTarget;const controls=button.closest('.practice-result-controls');const score=controls.querySelector('.practice-score').value;controls.querySelectorAll('button').forEach(item=>item.disabled=true);try{const data=await api('/api/practice/matches/'+encodeURIComponent(button.dataset.match)+'/result',{method:'PUT',body:JSON.stringify({winnerMemberId:button.dataset.winner,scoreDifference:score})});updatePractice(data);showToast('対戦結果を保存しました。')}catch(error){controls.querySelectorAll('button').forEach(item=>item.disabled=false);showToast(error.message)}}
async function saveExternalMatch(event){event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type="submit"]');const message=document.querySelector('#external-match-message');const fields=new FormData(form);button.disabled=true;message.textContent='保存しています…';try{const data=await api('/api/practice/external-matches',{method:'POST',body:JSON.stringify(Object.fromEntries(fields.entries()))});updatePractice(data);form.reset();setPracticeDates();message.textContent='';showToast('外部練習会の結果を追加しました。')}catch(error){message.textContent=error.message;message.classList.add('error')}finally{button.disabled=false}}
function setPracticeDates(){const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);document.querySelector('#practice-session-form [name="practiceDate"]').value||=today;document.querySelector('#external-match-form [name="playedOn"]').value||=today}
document.querySelector('#practice-session-form').addEventListener('submit',createPracticeSession);document.querySelector('#external-match-form').addEventListener('submit',saveExternalMatch);setPracticeDates();
`;
