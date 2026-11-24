/*
 * Widget do assistente: cole numa página qualquer (HTML, WordPress, outro framework).
 *
 *   <script src="https://SEU-ENDERECO/widget.js" async></script>
 *
 * Opcionais, como atributos da tag:
 *   data-color="#1a1a1a"           cor do botão
 *   data-position="right" | "left" lado da tela
 *   data-label="Fale com a gente"  texto do botão (leitor de tela e dica)
 *
 * O chat abre num iframe servido por este app (/embed): a chave do modelo e o agente
 * nunca passam pelo site que embute. Quais sites podem embutir: WIDGET_ALLOWED_ORIGINS.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__aiStarterWidget) return;
  window.__aiStarterWidget = true;

  var origin = new URL(script.src).origin;
  var color = script.getAttribute('data-color') || '#1a1a1a';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var label = script.getAttribute('data-label') || 'Abrir o assistente';

  var css =
    '.ais-btn{position:fixed;bottom:20px;' + side + ':20px;width:56px;height:56px;border-radius:50%;border:0;' +
    'background:' + color + ';color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483000;' +
    'display:flex;align-items:center;justify-content:center;transition:transform .2s ease}' +
    '.ais-btn:hover{transform:scale(1.06)}' +
    '.ais-btn svg{width:26px;height:26px}' +
    '.ais-panel{position:fixed;bottom:88px;' + side + ':20px;width:380px;height:min(600px,calc(100vh - 110px));' +
    'border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:2147483000;background:#fff;' +
    'opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .2s ease,transform .2s ease}' +
    '.ais-panel.ais-open{opacity:1;transform:none;pointer-events:auto}' +
    '@media (max-width:480px){.ais-panel{left:0;right:0;bottom:0;width:100%;height:100%;border-radius:0}' +
    '.ais-open~.ais-btn,.ais-panel.ais-open+.ais-btn{bottom:auto;top:12px}}' +
    '@media (prefers-reduced-motion:reduce){.ais-btn,.ais-panel{transition:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var panel = null; // o iframe só é criado no primeiro clique: a página não paga o chat sem uso
  var btn = document.createElement('button');
  btn.className = 'ais-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', 'false');
  btn.title = label;
  btn.innerHTML = ICON_CHAT;

  function toggle() {
    if (!panel) {
      panel = document.createElement('iframe');
      panel.className = 'ais-panel';
      panel.title = 'Assistente';
      panel.src = origin + '/embed';
      document.body.insertBefore(panel, btn);
    }
    var open = !panel.classList.contains('ais-open');
    // Um quadro para o navegador pintar o estado fechado antes: a transição aparece.
    requestAnimationFrame(function () { panel.classList.toggle('ais-open', open); });
    btn.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Fechar o assistente' : label);
  }
  btn.addEventListener('click', toggle);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel && panel.classList.contains('ais-open')) toggle();
  });

  function mount() { document.body.appendChild(btn); }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
