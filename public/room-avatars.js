/* ============================================================
   ENGIFAR - room.html interactive crew avatars
   Renders one draggable/tappable crew avatar per participant into
   a mount point (see init()) and keeps the count in sync with
   whatever participant list is handed in (see setParticipants()).

   Init strategy: unlike loading.js this file does NOT bind its own
   DOMContentLoaded listener. script.js's initRoom() (itself run from
   the site-wide DOMContentLoaded dispatcher) is the only caller of
   init(), and it already knows the real participant data (player
   name/color from the shared mission state) that this file has no
   access to on its own - so binding a second, parallel init here
   would either run with no data or risk a double-mount race. A
   single explicit init() call from script.js avoids that entirely.
   ============================================================ */

(function () {
  "use strict";

  const DRAG_THRESHOLD_PX = 10; // touch contact-patch jitter easily clears ~6px
  const RESIZE_DEBOUNCE_MS = 150;
  const COLLISION_GAP_PX = 4;
  const IDLE_MIN_MS = 2500;
  const IDLE_MAX_MS = 6000;
  const RELAX_ITERATIONS = 6;

  // Today's 5-participant default (4 crew + you), expressed as left/top
  // percentages of the field, matching the old .room-bot--* layout
  // (right:15% / bottom:18% / bottom:5% converted to their left/top
  // equivalents), in participant order so "you" lands bottom-center.
  const FIVE_SLOT_LAYOUT = [
    { left: 15, top: 27 },
    { left: 85, top: 27 },
    { left: 20, top: 82 },
    { left: 80, top: 82 },
    { left: 50, top: 95 }
  ];

  const TAP_REACTIONS = [
    { name: "spin", duration: 520 },
    { name: "sway", duration: 520 },
    { name: "hop", duration: 370 },
    { name: "bounce", duration: 470 }
  ];

  let containerEl = null;
  let resizeAttached = false;
  let resizeTimer = null;
  const avatars = new Map(); // id -> avatar record

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* ---------------- layout ---------------- */

  function ellipseLayout(count) {
    const points = [];
    const cx = 50;
    const cy = 55;
    const rx = 42;
    const ry = 38;
    for (let i = 0; i < count; i += 1) {
      const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
      points.push({ left: cx + rx * Math.cos(angle), top: cy + ry * Math.sin(angle) });
    }
    return points;
  }

  function layoutFor(count) {
    if (count === 5) return FIVE_SLOT_LAYOUT.slice();
    return ellipseLayout(count);
  }

  /* ---------------- geometry helpers ---------------- */

  function fieldSize() {
    const rect = containerEl.getBoundingClientRect();
    return { width: rect.width || 1, height: rect.height || 1 };
  }

  function pxFromPct(pct) {
    const size = fieldSize();
    return { x: (pct.x / 100) * size.width, y: (pct.y / 100) * size.height };
  }

  function pctFromPx(px) {
    const size = fieldSize();
    return { x: (px.x / size.width) * 100, y: (px.y / size.height) * 100 };
  }

  function boxHalfExtents(avatar) {
    const rect = avatar.el.getBoundingClientRect();
    return { hw: (rect.width || 1) / 2, hh: (rect.height || 1) / 2 };
  }

  function radiusOf(avatar) {
    const rect = avatar.el.getBoundingClientRect();
    return (rect.width + rect.height) / 4 + 3; // a little breathing room
  }

  function clampToFieldBox(px, avatar) {
    const size = fieldSize();
    const half = boxHalfExtents(avatar);
    const x = size.width <= half.hw * 2 ? size.width / 2 : clamp(px.x, half.hw, size.width - half.hw);
    const y = size.height <= half.hh * 2 ? size.height / 2 : clamp(px.y, half.hh, size.height - half.hh);
    return { x, y };
  }

  function applyPosition(avatar, px) {
    avatar.el.style.left = `${px.x}px`;
    avatar.el.style.top = `${px.y}px`;
  }

  // Adds the transient .18s left/top transition class used when a collision
  // nudges an avatar, then removes it again once the transition has had time
  // to finish - otherwise an avatar that is nudged once but never dragged
  // again would keep animating every future reposition (e.g. on resize).
  function markSettling(avatar) {
    avatar.el.classList.add("room-avatar--settle");
    window.clearTimeout(avatar.settleTimer);
    avatar.settleTimer = window.setTimeout(() => {
      avatar.el.classList.remove("room-avatar--settle");
    }, 300);
  }

  /* ---------------- collision resolution ---------------- */

  // While `reference` is being actively dragged: push every OTHER avatar
  // away so the dragged one always tracks the pointer exactly.
  function resolveCollisions(reference) {
    const refPx = pxFromPct(reference.pct);
    const refR = radiusOf(reference);
    avatars.forEach((other) => {
      if (other === reference || other.dragging) return;
      const otherPx = pxFromPct(other.pct);
      const otherR = radiusOf(other);
      const dx = otherPx.x - refPx.x;
      const dy = otherPx.y - refPx.y;
      const dist = Math.hypot(dx, dy);
      const minDist = refR + otherR + COLLISION_GAP_PX;
      if (dist >= minDist) return;
      // Perfectly coincident avatars have no direction to push along - pick one
      // at random instead of collapsing to a zero vector (which would leave
      // them stacked forever).
      const angle = dist < 0.001 ? Math.random() * Math.PI * 2 : 0;
      const ux = dist < 0.001 ? Math.cos(angle) : dx / dist;
      const uy = dist < 0.001 ? Math.sin(angle) : dy / dist;
      const overlap = minDist - Math.max(dist, 0.001);
      const pushed = clampToFieldBox({ x: otherPx.x + ux * overlap, y: otherPx.y + uy * overlap }, other);
      other.pct = pctFromPx(pushed);
      markSettling(other);
      applyPosition(other, pushed);
    });
  }

  // After a drop: relax every pair (not just the one that moved) so any
  // avatars compressed together during the drag settle apart too.
  function relaxAll(iterations) {
    const list = Array.from(avatars.values());
    for (let iter = 0; iter < iterations; iter += 1) {
      let moved = false;
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i];
          const b = list[j];
          if (a.dragging || b.dragging) continue;
          const aPx = pxFromPct(a.pct);
          const bPx = pxFromPct(b.pct);
          const aR = radiusOf(a);
          const bR = radiusOf(b);
          const dx = bPx.x - aPx.x;
          const dy = bPx.y - aPx.y;
          const dist = Math.hypot(dx, dy);
          const minDist = aR + bR + COLLISION_GAP_PX;
          if (dist >= minDist) continue;
          moved = true;
          // Perfectly coincident avatars have no direction to push along - pick
          // one at random instead of collapsing to a zero vector (which would
          // leave them stacked forever).
          const angle = dist < 0.001 ? Math.random() * Math.PI * 2 : 0;
          const ux = dist < 0.001 ? Math.cos(angle) : dx / dist;
          const uy = dist < 0.001 ? Math.sin(angle) : dy / dist;
          const overlap = (minDist - Math.max(dist, 0.001)) / 2;
          const aNew = clampToFieldBox({ x: aPx.x - ux * overlap, y: aPx.y - uy * overlap }, a);
          const bNew = clampToFieldBox({ x: bPx.x + ux * overlap, y: bPx.y + uy * overlap }, b);
          a.pct = pctFromPx(aNew);
          b.pct = pctFromPx(bNew);
          markSettling(a);
          markSettling(b);
          applyPosition(a, aNew);
          applyPosition(b, bNew);
        }
      }
      if (!moved) break;
    }
  }

  /* ---------------- idle / tap / drag visual states ---------------- */

  // Runs one JS-driven animation on `.room-avatar-inner`, then hands control
  // back to the idle bob. `avatar.animToken` is bumped by any state change
  // (drag start, another reaction) so a stale animationend/timeout from a
  // superseded animation can never stomp on whatever state came after it.
  function playInnerAnimation(avatar, modifier, duration, isReaction) {
    const inner = avatar.inner;
    const token = (avatar.animToken += 1);
    if (isReaction) avatar.reacting = true;
    inner.className = `room-avatar-inner room-avatar-inner--${modifier}`;

    let done = false;
    function finish() {
      if (done || token !== avatar.animToken) return;
      done = true;
      inner.removeEventListener("animationend", finish);
      if (isReaction) avatar.reacting = false;
      if (!avatar.dragging) {
        inner.className = "room-avatar-inner room-avatar-inner--bob";
        if (isReaction) scheduleIdle(avatar);
      }
    }
    inner.addEventListener("animationend", finish, { once: true });
    window.setTimeout(finish, duration + 120); // safety fallback if animationend never fires
  }

  function blinkOnce(avatar) {
    const eyes = avatar.el.querySelectorAll(".room-avatar-eye");
    eyes.forEach((eye) => eye.classList.add("is-blinking"));
    window.setTimeout(() => eyes.forEach((eye) => eye.classList.remove("is-blinking")), 260);
  }

  function scheduleIdle(avatar) {
    if (avatar.removed) return;
    window.clearTimeout(avatar.idleTimer);
    const delay = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
    avatar.idleTimer = window.setTimeout(() => runIdleBeat(avatar), delay);
  }

  function runIdleBeat(avatar) {
    if (avatar.dragging || avatar.reacting) {
      scheduleIdle(avatar);
      return;
    }
    const roll = Math.random();
    if (roll < 0.34) blinkOnce(avatar);
    else if (roll < 0.68) playInnerAnimation(avatar, "jump", 400, false);
    // else: do nothing this beat, just wait for the next one.
    scheduleIdle(avatar);
  }

  function doTapReaction(avatar) {
    if (avatar.dragging) return;
    window.clearTimeout(avatar.idleTimer);
    const pick = TAP_REACTIONS[Math.floor(Math.random() * TAP_REACTIONS.length)];
    playInnerAnimation(avatar, pick.name, pick.duration, true);
  }

  function enterDragState(avatar) {
    avatar.dragging = true;
    avatar.reacting = false;
    avatar.animToken += 1;
    window.clearTimeout(avatar.idleTimer);
    window.clearTimeout(avatar.settleTimer);
    avatar.el.classList.add("is-dragging");
    avatar.el.classList.remove("room-avatar--settle");
    avatar.inner.className = "room-avatar-inner room-avatar-inner--shiver";
  }

  function exitDragState(avatar) {
    avatar.dragging = false;
    avatar.animToken += 1;
    avatar.el.classList.remove("is-dragging");
    avatar.inner.className = "room-avatar-inner room-avatar-inner--bob";
    scheduleIdle(avatar);
  }

  /* ---------------- pointer (drag/tap) handling ---------------- */

  function onPointerDown(event, avatar) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Already tracking a different active pointer (e.g. a second finger
    // touching down on the same avatar mid-drag) - ignore it rather than
    // stealing pointerId, which would strand the first pointer's eventual
    // pointerup/pointercancel (id mismatch) with its capture never released
    // and the avatar's drag/reacting state never cleared.
    if (avatar.pointerId !== null && avatar.pointerId !== event.pointerId) return;
    avatar.pointerId = event.pointerId;
    try { avatar.el.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    avatar.dragStartClient = { x: event.clientX, y: event.clientY };
    avatar.dragStartPx = pxFromPct(avatar.pct);
    avatar.crossedThreshold = false;
  }

  function onPointerMove(event, avatar) {
    if (avatar.pointerId !== event.pointerId) return;
    const dx = event.clientX - avatar.dragStartClient.x;
    const dy = event.clientY - avatar.dragStartClient.y;
    if (!avatar.crossedThreshold) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      avatar.crossedThreshold = true;
      enterDragState(avatar);
    }
    const rawPx = { x: avatar.dragStartPx.x + dx, y: avatar.dragStartPx.y + dy };
    const clampedPx = clampToFieldBox(rawPx, avatar);
    avatar.pct = pctFromPx(clampedPx);
    applyPosition(avatar, clampedPx);
    resolveCollisions(avatar);
    event.preventDefault();
  }

  function onPointerEnd(event, avatar) {
    if (avatar.pointerId !== event.pointerId) return;
    try { avatar.el.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    const wasDrag = avatar.crossedThreshold;
    avatar.pointerId = null;
    avatar.crossedThreshold = false;
    if (wasDrag) {
      exitDragState(avatar);
      relaxAll(RELAX_ITERATIONS);
    } else {
      // Never crossed the drag threshold, however long the pointer was held -
      // that's a tap, not just a quick one.
      doTapReaction(avatar);
    }
  }

  /* ---------------- DOM construction ---------------- */

  function svgMarkup() {
    return "" +
      '<svg class="room-avatar-svg" viewBox="0 0 100 130" aria-hidden="true" focusable="false">' +
      '<ellipse cx="50" cy="118" rx="24" ry="7" fill="var(--crew-color, #54d37c)" opacity="0.3"></ellipse>' +
      '<line x1="50" y1="10" x2="50" y2="24" stroke="var(--crew-color, #54d37c)" stroke-width="4" stroke-linecap="round"></line>' +
      '<circle cx="50" cy="8" r="6" fill="#62e4ec"></circle>' +
      '<rect x="20" y="22" width="60" height="76" rx="30" fill="var(--crew-color, #54d37c)" stroke="rgba(255,255,255,.18)" stroke-width="2"></rect>' +
      '<rect x="32" y="42" width="36" height="26" rx="12" fill="#f0f7f5"></rect>' +
      '<circle class="room-avatar-eye" cx="43" cy="55" r="4" fill="#122232"></circle>' +
      '<circle class="room-avatar-eye" cx="57" cy="55" r="4" fill="#122232"></circle>' +
      "</svg>";
  }

  function syncTag(avatar, participant) {
    let tag = avatar.el.querySelector(".room-avatar-tag");
    if (participant.isYou && !tag) {
      tag = document.createElement("b");
      tag.className = "room-avatar-tag";
      tag.textContent = "YOU";
      avatar.el.appendChild(tag);
    } else if (!participant.isYou && tag) {
      tag.remove();
    }
  }

  function createAvatarEl(participant) {
    const root = document.createElement("div");
    root.className = "room-avatar";
    root.dataset.id = participant.id;
    root.style.setProperty("--crew-color", participant.color);
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", participant.name);
    root.title = participant.name;

    const inner = document.createElement("div");
    inner.className = "room-avatar-inner room-avatar-inner--bob";
    inner.innerHTML = `${svgMarkup()}<span class="room-avatar-sweat" aria-hidden="true"></span>`;
    root.appendChild(inner);

    return { root, inner };
  }

  function mountAvatar(participant, slot, animateEntrance) {
    const built = createAvatarEl(participant);
    const avatar = {
      id: participant.id,
      participant,
      el: built.root,
      inner: built.inner,
      pct: { x: slot.left, y: slot.top },
      pointerId: null,
      dragStartClient: null,
      dragStartPx: null,
      crossedThreshold: false,
      dragging: false,
      reacting: false,
      animToken: 0,
      idleTimer: null,
      settleTimer: null,
      removed: false
    };

    syncTag(avatar, participant);

    built.root.addEventListener("pointerdown", (event) => onPointerDown(event, avatar));
    built.root.addEventListener("pointermove", (event) => onPointerMove(event, avatar));
    built.root.addEventListener("pointerup", (event) => onPointerEnd(event, avatar));
    built.root.addEventListener("pointercancel", (event) => onPointerEnd(event, avatar));

    avatars.set(participant.id, avatar);
    containerEl.appendChild(built.root);
    applyPosition(avatar, pxFromPct(avatar.pct));

    if (animateEntrance) {
      built.root.classList.add("room-avatar--enter");
      const clearEnter = () => built.root.classList.remove("room-avatar--enter");
      built.root.addEventListener("animationend", clearEnter, { once: true });
      window.setTimeout(clearEnter, 450);
    }

    scheduleIdle(avatar);
    return avatar;
  }

  function removeAvatar(avatar) {
    window.clearTimeout(avatar.idleTimer);
    window.clearTimeout(avatar.settleTimer);
    avatar.animToken += 1;
    avatar.removed = true;
    // If this avatar is mid-drag when it's removed (its participant left the
    // room while held), release the pointer and clear the drag state so the
    // still-held pointer can't keep steering collisions for a removed avatar,
    // and so the eventual pointerup/pointercancel has nothing left to match.
    if (avatar.pointerId !== null) {
      try { avatar.el.releasePointerCapture(avatar.pointerId); } catch { /* ignore */ }
    }
    avatar.dragging = false;
    avatar.pointerId = null;
    avatar.crossedThreshold = false;
    avatars.delete(avatar.id);
    avatar.el.classList.add("room-avatar--exit");
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      avatar.el.remove();
    }
    avatar.el.addEventListener("animationend", finish, { once: true });
    window.setTimeout(finish, 400);
  }

  function updateAvatarData(avatar, participant) {
    avatar.participant = participant;
    avatar.el.style.setProperty("--crew-color", participant.color);
    avatar.el.setAttribute("aria-label", participant.name);
    avatar.el.title = participant.name;
    syncTag(avatar, participant);
  }

  /* ---------------- resize handling ---------------- */

  function repositionAll() {
    avatars.forEach((avatar) => {
      if (avatar.dragging) return;
      applyPosition(avatar, pxFromPct(avatar.pct));
    });
  }

  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(repositionAll, RESIZE_DEBOUNCE_MS);
  }

  /* ---------------- public API ---------------- */

  function init(options) {
    const opts = options || {};
    containerEl = document.querySelector(opts.containerSelector);
    if (!containerEl) return;

    avatars.forEach((avatar) => window.clearTimeout(avatar.idleTimer));
    avatars.clear();
    containerEl.replaceChildren();

    const list = Array.isArray(opts.participants) ? opts.participants : [];
    const slots = layoutFor(list.length);
    list.forEach((participant, index) => {
      mountAvatar(participant, slots[index] || { left: 50, top: 50 }, false);
    });

    if (!resizeAttached) {
      window.addEventListener("resize", onResize);
      resizeAttached = true;
    }
  }

  function setParticipants(list) {
    if (!containerEl || !Array.isArray(list)) return;

    const incomingIds = new Set(list.map((participant) => participant.id));
    Array.from(avatars.keys()).forEach((id) => {
      if (!incomingIds.has(id)) removeAvatar(avatars.get(id));
    });

    const slots = layoutFor(list.length);
    let addedAny = false;
    list.forEach((participant, index) => {
      const existing = avatars.get(participant.id);
      if (existing) {
        updateAvatarData(existing, participant);
      } else {
        mountAvatar(participant, slots[index] || { left: 50, top: 50 }, true);
        addedAny = true;
      }
    });

    if (addedAny) {
      window.requestAnimationFrame(() => relaxAll(RELAX_ITERATIONS));
    }
  }

  window.EngifarRoomAvatars = { init, setParticipants };
})();
