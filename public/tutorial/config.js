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
      id: 'files', page: 'files', title: 'はじめに', desc: 'ファイル一覧の見方と、録音の選び方', icon: 'wave', since: 2,
      steps: [
        { pose: 'wave', text: 'やあ！生物（ナマモノ）ナマ。RecPlayの案内役ナマ。この章では、録音ファイルの選び方を案内しナマ。先に言っておくと、この案内はいつでも✕ボタンでやめられるし、やめた後も右下のボタンから見直せナマ。' },
        { target: '.file-sort-bar', pose: 'point', text: '並べ替えはここナマ。録音した順や名前順に変えられナマ。' },
        { target: '.upload-toggle-btn', pose: 'point', text: '新しい録音のアップロードはここからナマ。練習のたびに録音を足していく場所ナマ。' },
        { target: '.change-btn', pose: 'point', text: '団体の切り替えや、最初の画面に戻る時はこの「戻る」からナマ。' },
        { target: '.file-item-btn', mode: 'tap', pose: 'point', text: '最後に、録音の行ナマ。押してみるナマ。その録音が開いて、プレイヤーに移りナマ。' }
      ]
    },
    {
      id: 'player', page: 'player', title: 'プレイヤー', desc: '再生・シーク・速度・区間リストの使い方', icon: 'yay', since: 3,
      steps: [
        { pose: 'wave', text: 'プレイヤーの章ナマ。曲を開いた状態だと、実際のボタンを光らせて案内できるナマ。ボタンは押しても説明は進まないので、結果をゆっくり見て大丈夫ナマ。まだ曲を開いてない時は、先にファイル一覧から曲を選ぶナマ。' },
        { target: '.file-bar', pose: 'point', text: '上の帯にファイル名と時間が出るナマ。右側の☁は、区間の保存がサーバーと合っているかの印ナマ。' },
        { target: '.seekbar-wrapper', mode: 'tap', pose: 'point', text: '波形と区間の帯ナマ。タップした場所から再生できて、区間の名前（ラベル）を押すと、その区間の冒頭へ移動しナマ。試しに触ってみるナマ。' },
        { target: '.play-btn', mode: 'tap', pose: 'point', text: '真ん中のボタンが再生と一時停止ナマ。押してみるナマ。このボタンを縦にスクロール／スワイプすると、再生速度を変えられナマ。遅くして練習する時に使うナマ。' },
        { target: '.skip-btn:not(.back-btn)', mode: 'tap', pose: 'point', text: 'このボタンは少し戻るナマ。反対側のボタンは少し進むナマ。秒数は設定モードで変えられナマ。いちばん端の⏮は、前の区間の頭へ戻るボタン。押してみるナマ。' },
        { target: '.section-list', mode: 'free', pose: 'point', text: '区間リストナマ。区間を押すと、そこだけ再生できナマ。長い録音の中で曲の頭出しをするのが主な使い方ナマ。実際に押してみるナマ。' },
        { target: '.zoom-row', mode: 'tap', pose: 'point', text: '波形の表示範囲はここで変えられナマ。1行に何秒分を表示するかの調節ナマ。広げると細かい場所が見やすく、縮めると全体の流れがつかめナマ。押してみるナマ。' },
        { target: '.org-name-link', pose: 'point', text: '上の団体名を押すと、ファイル一覧へ戻りナマ。' },
        { page: 'player-settings', target: '.settings-panel', pose: 'point', text: '最後は設定モード（画面が切り替わりナマ）。スキップの秒数や、区間を細かく動かす幅を変えられナマ。設定はこの端末の中に保存されナマ。' }
      ]
    },
    {
      id: 'edit', page: 'player', title: '編集', desc: '区間の追加と、範囲の決め直し方', icon: 'thinking', since: 3,
      steps: [
        { page: 'player', target: '.mode-selector', mode: 'tap', pose: 'point', text: '上のボタンで「再生」「編集」「設定」を切り替えるナマ。この章では編集を見ていくナマ。「編集」を押してみるナマ。' },
        { page: 'player-edit', target: '.section-list-header', pose: 'point', text: '区間を追加できるのは、ここの「＋」だけナマ。押すと、今の再生位置に30秒の区間ができナマ。追加した区間は自動でサーバーに保存されるナマ。試し打ちは、練習用の録音でやるのが安心ナマ。' },
        { page: 'player-edit', target: '.mark-controls', pose: 'point', text: '区間を選んだ状態で、再生しながら「ここから開始」「ここで終了」を押すと、区間の範囲を決め直せナマ。波形の上にある旗をドラッグしても動かせナマ。変更はその場でサーバーに保存されナマ。' },
        { page: 'player-edit', target: '.section-list', pose: 'point', text: '区間を選ぶと、名前の変更（名前をタップ）や削除、再生しない「除外」の切り替えができナマ。左端のハンドルをドラッグすると並べ替えもできナマ。' }
      ]
    }
  ]
};
