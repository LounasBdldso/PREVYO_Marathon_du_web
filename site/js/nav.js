// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
  if (id === 'home' && typeof updateHomeMetrics === 'function') updateHomeMetrics();
  if (id === 'visu' && state.events.length > 0) {
    buildVisuCharts();
    if (typeof resizeVisuCharts === 'function') resizeVisuCharts();
    buildTreemap();
  }
  if (id === 'demo') {
    if (state.events.length > 0 && typeof generateGraph === 'function') {
      generateGraph();
    } else if (typeof autoLoadDefaultData === 'function') {
      autoLoadDefaultData();
    }
    if (typeof refreshGraphLayout === 'function') refreshGraphLayout();
  }
}

function hydrateGraphLegend() {
  const legend = document.querySelector('.anomaly-legend');
  if (!legend) return;

  legend.innerHTML = `
    <div class="legend-item"><div class="legend-shape event"></div>Evenement</div>
    <div class="legend-item"><div class="legend-shape time"></div>Temps</div>
    <div class="legend-item"><div class="legend-shape person"></div>Personne</div>
    <div class="legend-item"><div class="legend-shape object"></div>Objet</div>
    <div class="legend-item"><div class="legend-shape other"></div>Autre</div>
    <div class="legend-item"><div class="legend-tone normal"></div>Normal</div>
    <div class="legend-item"><div class="legend-tone suspect"></div>Suspect</div>
    <div class="legend-item"><div class="legend-tone anomaly"></div>Critique</div>
    <div class="legend-item"><div class="legend-line"></div>Quasi-doublon</div>
  `;
}

document.addEventListener('DOMContentLoaded', hydrateGraphLegend);

// ═══════════════════════════════════════════════════════════
// HERO CANVAS ANIMATION
// ═══════════════════════════════════════════════════════════
(function heroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const nodes = [];
  let w, h;

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 55; i++) {
    nodes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 3 + 1.5,
      color: ['#1bae9f', '#09a4e8', '#bd33d1', '#625eec'][Math.floor(Math.random() * 4)],
      anomaly: Math.random() < 0.12
    });
  }

  function draw() {
    if (w !== canvas.offsetWidth || h !== canvas.offsetHeight) resize();
    ctx.clearRect(0, 0, w, h);

    // Arêtes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(27,174,159,${0.12 * (1 - dist / 130)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    // Nœuds
    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;

      if (n.anomaly) {
        ctx.shadowColor = '#ff4757'; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,71,87,0.25)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.anomaly ? '#ff4757' : n.color;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
})();
