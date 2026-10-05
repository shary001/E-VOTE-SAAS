/**
 * Civic Ledger UI Toolkit & Chart Engine
 * Lightweight, zero-dependency, production-ready interactive components.
 */

// ---------------------------------------------------------------- Toast Notifications
function showToast(message, type = "info", duration = 4200) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button type="button" style="background:none;border:none;color:#fff;cursor:pointer;opacity:0.75;font-size:1.1rem;padding:0 4px;" aria-label="Close">&times;</button>
  `;

  const closeBtn = toast.querySelector("button");
  const dismiss = () => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px) scale(0.96)";
    toast.style.transition = "all 180ms ease";
    setTimeout(() => toast.remove(), 200);
  };

  closeBtn.addEventListener("click", dismiss);
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
}

// ---------------------------------------------------------------- Modals
function showModal({ title, bodyHtml, confirmText = "Confirm", cancelText = "Cancel", onConfirm, isDanger = false }) {
  const existing = document.getElementById("active-modal-backdrop");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "active-modal-backdrop";
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost modal-cancel-btn">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${isDanger ? 'btn-danger' : 'btn-primary'} modal-confirm-btn">${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";

  const close = () => {
    backdrop.remove();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeyDown);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeyDown);

  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel-btn").addEventListener("click", close);

  const confirmBtn = backdrop.querySelector(".modal-confirm-btn");
  confirmBtn.addEventListener("click", async () => {
    if (onConfirm) {
      setButtonBusy(confirmBtn, true, "Processing…");
      try {
        await onConfirm();
        close();
      } catch (err) {
        showToast(err.message || "Action failed", "error");
        setButtonBusy(confirmBtn, false);
      }
    } else {
      close();
    }
  });
}

function showPromptModal({ title, message, label, placeholder = "", defaultValue = "", presets = [], confirmText = "Confirm", onConfirm }) {
  const presetOptions = presets.length
    ? `<div style="margin-bottom:12px">
        <label style="font-size:0.84rem;font-weight:600;display:block;margin-bottom:6px">Quick reason presets:</label>
        <select id="prompt-preset-select">
          <option value="">— Choose a preset or write custom note —</option>
          ${presets.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
        </select>
       </div>`
    : "";

  const bodyHtml = `
    <p style="margin-bottom:14px;color:var(--text-main)">${escapeHtml(message)}</p>
    ${presetOptions}
    <div class="field" style="margin-bottom:0">
      <label for="prompt-modal-input">${escapeHtml(label)}</label>
      <textarea id="prompt-modal-input" placeholder="${escapeHtml(placeholder)}">${escapeHtml(defaultValue)}</textarea>
    </div>
  `;

  showModal({
    title,
    bodyHtml,
    confirmText,
    isDanger: true,
    onConfirm: async () => {
      const input = document.getElementById("prompt-modal-input");
      const val = input ? input.value.trim() : "";
      if (onConfirm) await onConfirm(val);
    }
  });

  const select = document.getElementById("prompt-preset-select");
  if (select) {
    select.addEventListener("change", () => {
      if (select.value) {
        const input = document.getElementById("prompt-modal-input");
        if (input) input.value = select.value;
      }
    });
  }
}

// ---------------------------------------------------------------- Number Animation
function animateNumber(element, start, end, duration = 800) {
  if (!element) return;
  start = Number(start) || 0;
  end = Number(end) || 0;
  if (start === end) {
    element.textContent = end.toLocaleString();
    return;
  }
  const startTime = performance.now();
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (end - start) * ease);
    element.textContent = current.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = end.toLocaleString();
    }
  }
  requestAnimationFrame(update);
}

// ---------------------------------------------------------------- Confetti Celebration
function fireConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const width = canvas.width = window.innerWidth;
  const height = canvas.height = window.innerHeight;

  const colors = ["#C59B27", "#1B4332", "#2F6E56", "#DDB64E", "#FAF4E3", "#E9F5EE"];
  const pieces = Array.from({ length: 65 }, () => ({
    x: width * 0.5 + (Math.random() - 0.5) * 80,
    y: height * 0.45,
    vx: (Math.random() - 0.5) * 16,
    vy: (Math.random() - 0.8) * 18,
    size: Math.random() * 8 + 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 10,
    opacity: 1,
  }));

  const startTime = performance.now();
  function render(time) {
    const elapsed = time - startTime;
    ctx.clearRect(0, 0, width, height);

    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.42; // gravity
      p.vx *= 0.98; // air resistance
      p.rotation += p.rotationSpeed;
      if (elapsed > 1200) p.opacity -= 0.025;

      if (p.opacity > 0 && p.y < height + 20) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
    }

    if (alive && elapsed < 3500) {
      requestAnimationFrame(render);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------- Client CSV Downloader
function downloadCsv(filename, headers, rows) {
  const escapeCell = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = headers.map(h => escapeCell(typeof h === "object" ? h.label : h)).join(",");
  const keys = headers.map(h => typeof h === "object" ? h.key : h);
  const dataLines = rows.map(r => keys.map(k => escapeCell(r[k])).join(","));
  const csvContent = "\uFEFF" + [headerLine, ...dataLines].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------------------------------------------------------------- Native Canvas Charting
/**
 * Renders an animated high-DPI Donut Chart
 */
function renderDonutChart(canvasId, { labels = [], data = [], colors = [], centerText = "", centerSubtext = "" }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 280;
  const height = rect.height || 220;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(centerX, centerY) - 10;
  const innerRadius = outerRadius * 0.65;

  const defaultColors = ["#A855F7", "#38BDF8", "#34D399", "#F59E0B", "#EC4899", "#6366F1"];
  const sliceColors = colors.length ? colors : defaultColors;

  let animProgress = 0;
  const startTime = performance.now();
  const duration = 750;

  function draw(now) {
    const elapsed = now - startTime;
    animProgress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - animProgress, 3);

    ctx.clearRect(0, 0, width, height);

    if (total === 0) {
      // Empty state ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRadius, 0, 2 * Math.PI);
      ctx.arc(centerX, centerY, innerRadius, 2 * Math.PI, 0, true);
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fill();
      ctx.font = '600 13px "Public Sans", sans-serif';
      ctx.fillStyle = "#94A3B8";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No data yet", centerX, centerY);
      return;
    }

    let startAngle = -Math.PI / 2;
    for (let i = 0; i < data.length; i++) {
      const sliceVal = Number(data[i]) || 0;
      if (sliceVal <= 0) continue;
      const sliceAngle = (sliceVal / total) * (2 * Math.PI) * ease;
      const endAngle = startAngle + sliceAngle;

      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
      ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = sliceColors[i % sliceColors.length];
      ctx.fill();

      // subtle separator line
      ctx.strokeStyle = "rgba(10, 15, 28, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      startAngle = endAngle;
    }

    // Center text
    if (centerText) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(centerText, centerX, centerY - (centerSubtext ? 8 : 0));

      if (centerSubtext) {
        ctx.fillStyle = "#94A3B8";
        ctx.font = '600 11px "Public Sans", sans-serif';
        ctx.fillText(centerSubtext.toUpperCase(), centerX, centerY + 14);
      }
    }

    if (animProgress < 1) {
      requestAnimationFrame(draw);
    }
  }
  requestAnimationFrame(draw);
}

/**
 * Renders an animated Horizontal Bar Chart
 */
function renderBarChart(canvasId, { labels = [], data = [], colors = [], maxVal = null }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 320;
  const barHeight = 22;
  const gap = 16;
  const height = Math.max(160, labels.length * (barHeight + gap) + 30);

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const max = maxVal || Math.max(1, ...data.map(d => Number(d) || 0));
  const labelWidth = Math.min(110, width * 0.32);
  const chartWidth = width - labelWidth - 50;

  const defaultColor = "#A855F7";
  const startTime = performance.now();
  const duration = 650;

  function draw(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);

    ctx.clearRect(0, 0, width, height);

    labels.forEach((label, i) => {
      const val = Number(data[i]) || 0;
      const y = 14 + i * (barHeight + gap);
      const barW = (val / max) * chartWidth * ease;
      const color = colors[i % colors.length] || defaultColor;

      // Label text
      ctx.fillStyle = "#CBD5E1";
      ctx.font = '500 12px "Public Sans", sans-serif';
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const truncated = label.length > 15 ? label.slice(0, 14) + "…" : label;
      ctx.fillText(truncated, labelWidth - 10, y + barHeight / 2);

      // Track background
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      roundRect(ctx, labelWidth, y, chartWidth, barHeight, 4);
      ctx.fill();

      // Filled bar
      if (barW > 0) {
        ctx.fillStyle = color;
        roundRect(ctx, labelWidth, y, Math.max(barW, 6), barHeight, 4);
        ctx.fill();
      }

      // Value text
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '700 12px "Public Sans", sans-serif';
      ctx.textAlign = "left";
      ctx.fillText(val.toLocaleString(), labelWidth + chartWidth + 10, y + barHeight / 2);
    });

    if (progress < 1) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

/**
 * Renders an animated Turnout Gauge (circular arc)
 */
function renderTurnoutGauge(canvasId, { percentage = 0, label = "Turnout" }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const width = canvas.width = 160 * dpr;
  const height = canvas.height = 130 * dpr;
  ctx.scale(dpr, dpr);

  const centerX = 80;
  const centerY = 85;
  const radius = 55;
  const lineWidth = 12;

  const startAngle = Math.PI * 0.85;
  const endAngle = Math.PI * 2.15;
  const totalSweep = endAngle - startAngle;

  const startTime = performance.now();
  const duration = 850;

  function draw(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);

    ctx.clearRect(0, 0, 160, 130);

    // Background Arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();

    // Progress Arc
    const currentPercent = Math.min(100, Math.max(0, percentage)) * ease;
    const progressAngle = startAngle + (currentPercent / 100) * totalSweep;

    if (currentPercent > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, progressAngle);
      ctx.strokeStyle = currentPercent > 60 ? "#34D399" : currentPercent > 30 ? "#A855F7" : "#38BDF8";
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // Text in center
    ctx.textAlign = "center";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = '700 20px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`${Math.round(currentPercent)}%`, centerX, centerY - 2);

    ctx.fillStyle = "#94A3B8";
    ctx.font = '600 10px "Public Sans", sans-serif';
    ctx.fillText(label.toUpperCase(), centerX, centerY + 16);

    if (progress < 1) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
