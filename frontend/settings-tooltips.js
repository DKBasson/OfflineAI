(() => {
  const triggers = () => [...document.querySelectorAll('.settings-tip[data-tip]')];
  const tooltip = document.createElement('div');
  tooltip.id = 'settings-tooltip';
  tooltip.className = 'settings-tooltip-layer';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);

  let activeTrigger = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function positionTooltip() {
    if (!activeTrigger) return;
    const triggerRect = activeTrigger.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const margin = 10;

    let top = triggerRect.top - tipRect.height - margin;
    if (top < 8) top = triggerRect.bottom + margin;

    const centered = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
    const left = clamp(centered, 8, window.innerWidth - tipRect.width - 8);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showTooltip(trigger) {
    activeTrigger = trigger;
    tooltip.textContent = trigger.dataset.tip || '';
    tooltip.classList.add('visible');
    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
  }

  function hideTooltip(trigger) {
    if (trigger && activeTrigger !== trigger) return;
    activeTrigger = null;
    tooltip.classList.remove('visible');
    window.removeEventListener('resize', positionTooltip);
    window.removeEventListener('scroll', positionTooltip, true);
  }

  document.addEventListener('pointerover', event => {
    const trigger = event.target.closest?.('.settings-tip[data-tip]');
    if (trigger) showTooltip(trigger);
  });

  document.addEventListener('pointerout', event => {
    const trigger = event.target.closest?.('.settings-tip[data-tip]');
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    hideTooltip(trigger);
  });

  document.addEventListener('focusin', event => {
    const trigger = event.target.closest?.('.settings-tip[data-tip]');
    if (trigger) showTooltip(trigger);
  });

  document.addEventListener('focusout', event => {
    const trigger = event.target.closest?.('.settings-tip[data-tip]');
    if (trigger) hideTooltip(trigger);
  });

  for (const trigger of triggers()) {
    trigger.setAttribute('aria-describedby', 'settings-tooltip');
  }
})();
