/* RecPlay 用チュートリアル設定（NamaTutorial キット v1）
   キャラの口調: 基本は丁寧語。文末は「です」「ます」の代わりに「ナマ」を語幹へ直接付ける（規格参照）
   ページID: files=ファイル一覧 / player=プレイヤー(再生) / player-edit=プレイヤー(編集) / player-settings=プレイヤー(設定)
   橋渡し（src/App.tsx の NamaTutorialBridge）がモード切替まで面倒を見る */
window.NAMA_TUTORIAL_CONFIG = {
  appId: 'recplay',
  assetBase: 'tutorial/img/',
  buttonImage: 'tutorial/img/tutorial-button.png',
  buttonPages: ['files', 'player', 'player-edit', 'player-settings'], // ログイン画面には出さない
  startWithCurrentChapter: true, // 初回は「今いる画面の章」から始める（共有URLでプレイヤー直行の人が大半のため）
  bridge: 'NamaTutorialBridge',
  introTitle: 'RecPlayの使い方',
  introText: '練習の録音を聴くためのアプリだナマ。区間の再生や、速度を変えての練習のやり方を案内しナマ。',
  chapters: [
    {
      id: 'files', page: 'files', title: 'はじめに', desc: 'ファイル一覧の見方と、録音の選び方', icon: 'wave', since: 1,
      steps: [
        { pose: 'wave', text: 'やあ！生物（ナマモノ）ナマ。RecPlayの案内役ナマ。この章では、録音ファイルの選び方を案内しナマ。先に言っておくと、この案内はいつでも✕ボタンでやめられるし、やめた後も右下のボタンから見直せナマ。' },
        { target: '.file-item-btn', pose: 'point', text: '録音はここに並ぶナマ。タップするとプレイヤーが開きナマ。' },
        { target: '.file-sort-bar', pose: 'point', text: '並べ替えはここナマ。録音した順や名前順に変えられナマ。' },
        { target: '.upload-toggle-btn', pose: 'point', text: '新しい録音のアップロードはここからナマ。練習のたびに録音を足していく場所ナマ。' },
        { target: '.change-btn', pose: 'point', text: '団体の切り替えや、最初の画面に戻る時はこの「戻る」からナマ。' }
      ]
    },
    {
      id: 'player', page: 'player', title: 'プレイヤー', desc: '再生・シーク・速度・区間リストの使い方', icon: 'yay', since: 1,
      steps: [
        { pose: 'wave', text: 'プレイヤーの章ナマ。曲を開いた状態だと、実際のボタンを光らせて案内できるナマ。まだ曲を開いてない時は、先にファイル一覧から曲を選ぶナマ。' },
        { target: '.file-bar', pose: 'point', text: '上の帯に曲名と時間が出るナマ。右側の☁は、区間の保存がサーバーと合っているかの印ナマ。' },
        { target: '.seekbar-wrapper', pose: 'point', text: '波形と区間の帯ナマ。タップした場所から再生できて、区間の名前を押すとその区間へ跳びナマ。' },
        { target: '.play-btn', pose: 'point', text: '真ん中のボタンが再生と一時停止ナマ。このボタンをスクロール／スワイプすると、再生速度を変えられナマ。遅くして練習する時に使うナマ。' },
        { target: '.skip-btn', pose: 'point', text: '両脇のボタンは、少し戻る／少し進むナマ。秒数は設定で変えられナマ。' },
        { target: '.section-list', pose: 'point', text: '区間リストナマ。区間を押すと、そこだけ再生できナマ。繰り返し聴きたい場所の練習に使うナマ。' },
        { target: '.zoom-row', pose: 'point', text: '波形の拡大・縮小はここナマ。細かい場所を見る時に広げるナマ。' },
        { target: '.org-name-link', pose: 'point', text: '上の団体名を押すと、ファイル一覧へ戻りナマ。' }
      ]
    },
    {
      id: 'edit', page: 'player', title: '編集と設定', desc: '区間を作る編集モードと、設定モードの案内', icon: 'thinking', since: 1,
      steps: [
        { page: 'player', target: '.mode-selector', pose: 'point', text: '上のボタンで「再生」「編集」「設定」を切り替えるナマ。この章では編集と設定を見ていくナマ。' },
        { page: 'player-edit', target: '.mark-controls', pose: 'point', text: '編集モードでは、再生しながら区間の開始と終了を打てるナマ。打った区間は自動でサーバーに保存されるナマ。試し打ちは、練習用の録音でやるのが安心ナマ。' },
        { page: 'player-edit', target: '.section-list-header', pose: 'point', text: '区間リストの＋からも区間を足せるナマ。並べ替えや削除も、編集モードの仕事ナマ。' },
        { page: 'player-settings', target: '.settings-panel', pose: 'point', text: '設定モードでは、スキップの秒数や、区間を細かく動かす幅を変えられナマ。設定はこの端末の中に保存されるナマ。' }
      ]
    }
  ]
};
