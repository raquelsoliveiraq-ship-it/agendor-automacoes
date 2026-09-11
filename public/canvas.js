// Canvas de fluxo interativo (arrastar cards, zoom, pan do fundo).
// Vanilla JS, sem dependências — um mini editor de nós reusável para
// qualquer automação (steps estáticos ou template dinâmico).

function createFlowCanvas(container, automationId) {
  const STORAGE_KEY = `agendor-canvas:${automationId}`;
  const CARD_WIDTH = 260;
  const CARD_HEIGHT = 96;
  const H_GAP = 60;

  const root = document.createElement('div');
  root.className = 'flow-canvas';
  root.innerHTML = `
    <div class="flow-toolbar">
      <button type="button" class="flow-btn flow-zoom-out" title="Diminuir zoom">−</button>
      <span class="flow-zoom-level">100%</span>
      <button type="button" class="flow-btn flow-zoom-in" title="Aumentar zoom">+</button>
      <button type="button" class="flow-btn flow-zoom-fit" title="Ajustar à tela">⤢</button>
    </div>
    <div class="flow-viewport">
      <div class="flow-world">
        <svg class="flow-lines"></svg>
      </div>
    </div>
  `;
  container.appendChild(root);

  const viewport = root.querySelector('.flow-viewport');
  const world = root.querySelector('.flow-world');
  const svg = root.querySelector('.flow-lines');
  const zoomLevelEl = root.querySelector('.flow-zoom-level');

  function loadLayout() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveLayout(layout) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }

  let layout = loadLayout();
  let hasStoredView = Boolean(layout.__view);
  let view = layout.__view || { x: 40, y: 40, scale: 1 };
  let cards = []; // { el, index }

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    zoomLevelEl.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function persistView() {
    layout.__view = view;
    saveLayout(layout);
  }

  function defaultPosition(i) {
    return { x: i * (CARD_WIDTH + H_GAP), y: i % 2 === 0 ? 40 : 150 };
  }

  function fitToContent() {
    if (cards.length === 0) return;
    const xs = cards.map((c) => parseFloat(c.el.style.left));
    const ys = cards.map((c) => parseFloat(c.el.style.top));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + CARD_WIDTH;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + CARD_HEIGHT;

    const padding = 30;
    const vpWidth = viewport.clientWidth || 600;
    const vpHeight = viewport.clientHeight || 300;
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const scale = Math.min(2, Math.max(0.4, Math.min((vpWidth - padding * 2) / contentWidth, (vpHeight - padding * 2) / contentHeight)));

    view = {
      x: padding + (vpWidth - padding * 2 - contentWidth * scale) / 2 - minX * scale,
      y: padding + (vpHeight - padding * 2 - contentHeight * scale) / 2 - minY * scale,
      scale,
    };
    applyView();
    persistView();
  }

  function redrawLines() {
    const w = Math.max(1600, cards.length * (CARD_WIDTH + H_GAP) + 200);
    const h = 600;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    let paths = '';
    for (let i = 0; i < cards.length - 1; i++) {
      const a = cards[i].el;
      const b = cards[i + 1].el;
      const ax = parseFloat(a.style.left) + CARD_WIDTH;
      const ay = parseFloat(a.style.top) + CARD_HEIGHT / 2;
      const bx = parseFloat(b.style.left);
      const by = parseFloat(b.style.top) + CARD_HEIGHT / 2;
      const midX = (ax + bx) / 2;
      paths += `<path d="M ${ax} ${ay} C ${midX} ${ay}, ${midX} ${by}, ${bx} ${by}" class="flow-connector" />`;
      paths += `<circle cx="${(ax + bx) / 2}" cy="${(ay + by) / 2}" r="3" class="flow-connector-dot" />`;
    }
    svg.innerHTML = paths;
  }

  function makeCardDraggable(cardEl, index) {
    cardEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = parseFloat(cardEl.style.left);
      const startTop = parseFloat(cardEl.style.top);
      cardEl.classList.add('dragging');

      function onMove(ev) {
        const dx = (ev.clientX - startX) / view.scale;
        const dy = (ev.clientY - startY) / view.scale;
        cardEl.style.left = `${startLeft + dx}px`;
        cardEl.style.top = `${startTop + dy}px`;
        redrawLines();
      }
      function onUp() {
        cardEl.classList.remove('dragging');
        layout[index] = { x: parseFloat(cardEl.style.left), y: parseFloat(cardEl.style.top) };
        saveLayout(layout);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function setSteps(steps) {
    if (cards.length !== steps.length) {
      world.querySelectorAll('.flow-card').forEach((el) => el.remove());
      cards = [];
      steps.forEach((step, i) => {
        const pos = layout[i] || defaultPosition(i);
        const card = document.createElement('div');
        card.className = 'flow-card';
        card.style.left = `${pos.x}px`;
        card.style.top = `${pos.y}px`;
        card.style.width = `${CARD_WIDTH}px`;
        world.appendChild(card);
        makeCardDraggable(card, i);
        cards.push({ el: card, index: i });
      });
      if (!hasStoredView) {
        hasStoredView = true;
        requestAnimationFrame(fitToContent);
      }
    }
    steps.forEach((step, i) => {
      cards[i].el.innerHTML = `
        <span class="step-label">${step.label}</span>
        <div class="step-title">${step.title}</div>
        <div class="step-detail">${step.detail}</div>
      `;
    });
    redrawLines();
  }

  // Pan: arrastar o fundo do viewport (fora dos cards) move o mundo.
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.flow-card')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startViewX = view.x;
    const startViewY = view.y;
    viewport.classList.add('panning');

    function onMove(ev) {
      view.x = startViewX + (ev.clientX - startX);
      view.y = startViewY + (ev.clientY - startY);
      applyView();
    }
    function onUp() {
      viewport.classList.remove('panning');
      persistView();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Zoom: roda do mouse sobre o viewport, centrado no cursor.
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const worldX = (cursorX - view.x) / view.scale;
      const worldY = (cursorY - view.y) / view.scale;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.min(2, Math.max(0.4, view.scale * factor));

      view.x = cursorX - worldX * newScale;
      view.y = cursorY - worldY * newScale;
      view.scale = newScale;
      applyView();
      persistView();
    },
    { passive: false }
  );

  root.querySelector('.flow-zoom-in').addEventListener('click', () => {
    view.scale = Math.min(2, view.scale * 1.2);
    applyView();
    persistView();
  });
  root.querySelector('.flow-zoom-out').addEventListener('click', () => {
    view.scale = Math.max(0.4, view.scale / 1.2);
    applyView();
    persistView();
  });
  root.querySelector('.flow-zoom-fit').addEventListener('click', fitToContent);

  applyView();

  // `refit` deixa o quadro reajustar quando ele só ganha tamanho depois de
  // renderizado (por exemplo, ao abrir a seção "Etapas" pela primeira vez).
  return { setSteps, refit: fitToContent };
}

window.createFlowCanvas = createFlowCanvas;
