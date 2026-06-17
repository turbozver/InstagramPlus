const settings = {
    instdecreasevolume: false,
    instdecreasevolume_value: 3.5,
    instspacepause: false,
    instmalwaysmute: false,
    instaddcontrols: false,
    instaddpostslidecontrols: false,
    instaddseekbar: false,
    instPauseKey: "Space",
    instMuteKey: "KeyM",
    instSeekSmallBackKey: "KeyQ",
    instSeekSmallForwardKey: "KeyE",
    instSeekMediumBackKey: "KeyA",
    instSeekMediumForwardKey: "KeyD",
    instSeekLargeBackKey: "KeyZ",
    instSeekLargeForwardKey: "KeyC",
    instSeekSmallSeconds: 0.1,
    instSeekMediumSeconds: 1,
    instSeekLargeSeconds: 3,
    instVolumeScale: "percent"
};

const gainMap = new WeakMap();
const muteButtonMap = new WeakMap();
const desiredMuteMap = new WeakMap();
const muteEnforcerMap = new WeakMap();
let volumeObserver = null;
let seekbarObserver = null;
let manualMuteInteraction = null;

chrome.storage.local.get(Object.keys(settings), (data) => {
    migrateVolumeValue(data);
    Object.assign(settings, data);
    runWhenDocumentReady(() => {
        applyVolumeMode();
        applySeekbarMode();
    });
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "setting_changed") return;
    if (!(message.name in settings)) return;

    settings[message.name] = message.value;

    if (message.name === "instdecreasevolume" || message.name === "instdecreasevolume_value") {
        applyVolumeMode();
    }

    if (message.name === "instaddseekbar") {
        applySeekbarMode();
    }
});

window.addEventListener("keydown", handleKeydown, true);
document.addEventListener("keydown", handleKeydown, true);
window.addEventListener("keypress", suppressMuteKey, true);
document.addEventListener("keypress", suppressMuteKey, true);
window.addEventListener("keyup", suppressMuteKey, true);
document.addEventListener("keyup", suppressMuteKey, true);
window.addEventListener("pointerdown", handleManualMutePointer, true);
document.addEventListener("pointerdown", handleManualMutePointer, true);

function handleKeydown(event) {
    if (event.instagramPlusHandled) return;

    if (settings.instaddcontrols && getSeekDelta(event) !== null && isMediaPage()) {
        event.instagramPlusHandled = true;
        handleSeekKeys(event);
        return;
    }

    if (settings.instmalwaysmute && isMuteKey(event) && isMediaPage()) {
        event.instagramPlusHandled = true;
        handleMuteToggle(event);
        return;
    }

    if (isTypingTarget(event.target)) return;

    if (settings.instspacepause && isPauseKey(event)) {
        event.instagramPlusHandled = true;
        handleSpacePause(event);
    }

    if (settings.instaddpostslidecontrols) {
        event.instagramPlusHandled = true;
        handlePostSlideKeys(event);
    }
}

function suppressMuteKey(event) {
    if (!settings.instmalwaysmute || !isMuteKey(event) || !isMediaPage()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function handleManualMutePointer(event) {
    if (!event.isTrusted || !isMediaPage()) return;

    const video = getActiveVideo();
    if (!video) return;

    const button = event.target?.closest?.("button, div[role='button']");
    if (!button || !isManualMuteButton(button, video)) return;

    manualMuteInteraction = {
        video,
        expiresAt: Date.now() + 700
    };

    setTimeout(() => {
        if (manualMuteInteraction?.video !== video) return;
        rememberDesiredVideoMuted(video, video.muted);
        manualMuteInteraction = null;
        debugMute("manual mute state", {
            muted: video.muted,
            button: describeElement(button)
        });
    }, 180);
}

function applyVolumeMode() {
    if (volumeObserver) {
        volumeObserver.disconnect();
        volumeObserver = null;
    }

    updateMediaVolume();

    if (!settings.instdecreasevolume) return;
    if (!document.body) return;

    volumeObserver = new MutationObserver(updateMediaVolume);
    volumeObserver.observe(document.body, { childList: true, subtree: true });
}

function updateMediaVolume() {
    const volume = settings.instdecreasevolume
        ? clampVolume(settings.instdecreasevolume_value) / 100
        : 1;

    document.querySelectorAll("video, audio").forEach((element) => attachGainControl(element, volume));
}

function attachGainControl(element, volume) {
    if (gainMap.has(element)) {
        gainMap.get(element).gainNode.gain.value = volume;
        return;
    }

    try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(element);
        const gainNode = audioContext.createGain();

        gainNode.gain.value = volume;
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        gainMap.set(element, { audioContext, source, gainNode });

        element.addEventListener("play", () => {
            if (audioContext.state === "suspended") {
                audioContext.resume().catch(() => {});
            }
        });
    } catch (error) {}
}

function handleSpacePause(event) {
    if (!isPauseKey(event)) return;

    event.stopImmediatePropagation();

    const video = getActiveVideo();
    if (video) {
        if (video.paused) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }

        event.preventDefault();
        return;
    }

    if (!location.href.includes("instagram.com/stories/")) return;

    const mainDiv = Array.from(document.querySelectorAll("div.x5yr21d.x1n2onr6.xh8yej3"))
        .filter((element) => element.parentElement?.clientHeight > 500)[0];
    const pauseButton = mainDiv?.querySelector('div.x78zum5[role="button"]');
    if (pauseButton) {
        pauseButton.click();
        event.preventDefault();
    }
}

function handleMuteToggle(event) {
    const video = getActiveVideo();

    event.preventDefault();
    event.stopImmediatePropagation();

    debugMute("pressed", {
        hasVideo: !!video,
        pathname: location.pathname,
        target: describeElement(event.target)
    });

    if (!video) return;

    const targetMuted = !video.muted;
    const muteButton = getMuteButtonForVideo(video);
    debugMuteCandidates(video, muteButton ? "selected button" : "no button", muteButton);

    if (muteButton) {
        rememberMuteButton(video, muteButton);
        rememberDesiredVideoMuted(video, targetMuted);
        activateControl(muteButton);
        setTimeout(() => enforceVideoMuted(video), 120);
        return;
    }

    const cachedButton = getCachedMuteButton(video);
    if (cachedButton) {
        debugMute("selected cached button", {
            selected: describeElement(cachedButton)
        });
        rememberDesiredVideoMuted(video, targetMuted);
        activateControl(cachedButton);
        setTimeout(() => enforceVideoMuted(video), 120);
        return;
    }

    debugMute("fallback video.muted", {
        from: video.muted,
        to: targetMuted
    });
    setDesiredVideoMuted(video, targetMuted);
}

function setVideoMuted(video, muted) {
    video.muted = muted;
    video.dispatchEvent(new Event("volumechange", { bubbles: true }));
}

function setDesiredVideoMuted(video, muted) {
    rememberDesiredVideoMuted(video, muted);
    setVideoMuted(video, muted);
}

function rememberDesiredVideoMuted(video, muted) {
    desiredMuteMap.set(video, muted);
    bindMuteEnforcer(video);
}

function bindMuteEnforcer(video) {
    if (muteEnforcerMap.has(video)) return;

    const enforce = () => {
        setTimeout(() => enforceVideoMuted(video), 0);
        setTimeout(() => enforceVideoMuted(video), 120);
    };

    video.addEventListener("play", enforce);
    video.addEventListener("playing", enforce);
    video.addEventListener("volumechange", enforce);
    muteEnforcerMap.set(video, enforce);
}

function enforceVideoMuted(video) {
    if (!desiredMuteMap.has(video)) return;

    if (manualMuteInteraction?.video === video && manualMuteInteraction.expiresAt > Date.now()) {
        desiredMuteMap.set(video, video.muted);
        return;
    }

    const muted = desiredMuteMap.get(video);
    if (video.muted === muted) return;

    debugMute("enforce video.muted", {
        from: video.muted,
        to: muted
    });
    video.muted = muted;
}

function getActiveVideo() {
    const audible = Array.from(document.querySelectorAll("video"))
        .find((video) => !video.paused && !video.muted);

    if (audible) return audible;

    const centerY = window.innerHeight / 2;
    let best = null;
    let bestDistance = Infinity;

    document.querySelectorAll("video").forEach((video) => {
        const rect = video.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - centerY);

        if (distance < bestDistance && rect.height > 50) {
            best = video;
            bestDistance = distance;
        }
    });

    return best;
}

function getCurrentVideo() {
    return getActiveVideo();
}

function handleSeekKeys(event) {
    const delta = getSeekDelta(event);
    if (delta === null) return;

    const video = getCurrentVideo();
    if (video) {
        seek(video, delta);
    }

    event.preventDefault();
    event.stopImmediatePropagation();
}

function handlePostSlideKeys(event) {
    if (!location.pathname.includes("/p/")) return;
    if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;

    const article = document.querySelector("article");
    if (!article) return;

    const labels = event.code === "ArrowUp"
        ? ["Go back", "Назад"]
        : ["Next", "Далее"];

    const button = Array.from(article.querySelectorAll("button[aria-label]"))
        .find((item) => labels.includes(item.getAttribute("aria-label")));

    if (!button) return;

    button.click();
    event.preventDefault();
    event.stopImmediatePropagation();
}

function seek(video, delta) {
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration || Infinity);
}

function applySeekbarMode() {
    if (seekbarObserver) {
        seekbarObserver.disconnect();
        seekbarObserver = null;
    }

    removeCustomSeekbars();

    if (!settings.instaddseekbar) return;

    injectCustomSeekbar();

    if (!document.body) return;
    seekbarObserver = new MutationObserver(injectCustomSeekbar);
    seekbarObserver.observe(document.body, { childList: true, subtree: true });
}

function injectCustomSeekbar() {
    const video = getCurrentVideo();
    if (!video || video.dataset.instagramPlusSeekbarAttached === "true") return;

    document.querySelectorAll(".instagram-plus-seekbar").forEach((bar) => {
        const owner = bar.closest("[data-instagram-plus-seekbar-owner='true']");
        if (owner && owner.contains(video)) return;
        bar.remove();
    });

    const bar = document.createElement("div");
    bar.className = "instagram-plus-seekbar";
    bar.style.position = "absolute";
    bar.style.bottom = "10px";
    bar.style.left = "5%";
    bar.style.width = "90%";
    bar.style.height = "6px";
    bar.style.background = "rgba(255,255,255,0.3)";
    bar.style.borderRadius = "3px";
    bar.style.cursor = "pointer";
    bar.style.zIndex = "9999";

    const fill = document.createElement("div");
    fill.style.height = "100%";
    fill.style.width = "0%";
    fill.style.background = "rgba(255,255,255,0.9)";
    fill.style.borderRadius = "3px";
    bar.appendChild(fill);

    const updateFill = () => {
        fill.style.width = `${video.currentTime / video.duration * 100 || 0}%`;
    };

    bar.addEventListener("click", (event) => {
        const rect = bar.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        video.currentTime = ratio * video.duration;
    });

    video.parentElement.style.position = "relative";
    video.parentElement.dataset.instagramPlusSeekbarOwner = "true";
    video.parentElement.appendChild(bar);
    video.addEventListener("timeupdate", updateFill);
    video.dataset.instagramPlusSeekbarAttached = "true";
}

function removeCustomSeekbars() {
    document.querySelectorAll(".instagram-plus-seekbar").forEach((bar) => bar.remove());
    document.querySelectorAll("video[data-instagram-plus-seekbar-attached]").forEach((video) => {
        video.dataset.instagramPlusSeekbarAttached = "false";
    });
}

function isTypingTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return tagName === "input" || tagName === "textarea" || target?.isContentEditable;
}

function isMediaPage() {
    return location.pathname.includes("/reel/") ||
        location.pathname.includes("/reels/") ||
        location.pathname.includes("/p/") ||
        location.pathname.includes("/stories/") ||
        isFeedPageWithVideo();
}

function getSeekDelta(event) {
    const seekMap = [
        [settings.instSeekSmallBackKey, -normalizeSeconds(settings.instSeekSmallSeconds, 0.1)],
        [settings.instSeekSmallForwardKey, normalizeSeconds(settings.instSeekSmallSeconds, 0.1)],
        [settings.instSeekMediumBackKey, -normalizeSeconds(settings.instSeekMediumSeconds, 1)],
        [settings.instSeekMediumForwardKey, normalizeSeconds(settings.instSeekMediumSeconds, 1)],
        [settings.instSeekLargeBackKey, -normalizeSeconds(settings.instSeekLargeSeconds, 3)],
        [settings.instSeekLargeForwardKey, normalizeSeconds(settings.instSeekLargeSeconds, 3)]
    ];

    const match = seekMap.find(([shortcut]) => isShortcut(event, shortcut));
    return match ? match[1] : null;
}

function isMuteKey(event) {
    return isShortcut(event, settings.instMuteKey);
}

function isPauseKey(event) {
    return isShortcut(event, settings.instPauseKey);
}

function isShortcut(event, shortcut) {
    const parsed = parseShortcut(shortcut);
    if (!parsed) return false;

    return event.code === parsed.code &&
        event.ctrlKey === parsed.ctrl &&
        event.altKey === parsed.alt &&
        event.shiftKey === parsed.shift &&
        event.metaKey === parsed.meta;
}

function parseShortcut(shortcut) {
    if (!shortcut || typeof shortcut !== "string") return null;

    const parts = shortcut.split("+").filter(Boolean);
    const code = parts.pop();
    if (!code) return null;

    return {
        code,
        ctrl: parts.includes("Ctrl"),
        alt: parts.includes("Alt"),
        shift: parts.includes("Shift"),
        meta: parts.includes("Meta")
    };
}

function isFeedPageWithVideo() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    return (path === "/" || path === "/explore" || path === "/reels") && !!getCurrentVideo();
}

function getMuteButtonForVideo(video) {
    const scopes = getVideoScopes(video);
    const searchRect = getAudioSearchRect(video);
    const candidates = [];
    const seen = new Set();

    scopes.forEach((scope) => {
        scope.querySelectorAll("button, div[role='button']").forEach((element) => {
            if (!isVisibleElement(element)) return;

            const rect = element.getBoundingClientRect();
            if (!isNearRect(rect, searchRect, 260)) return;

            const label = getElementLabel(element);
            if (isUnsafeControlLabel(label)) return;

            if (isAudioToggleLabel(label)) {
                addMuteButtonCandidate(candidates, seen, element, getAudioToggleScore(label) + getDistanceScore(rect, searchRect));
            }
        });
    });

    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.element || null;
}

function rememberMuteButton(video, button) {
    muteButtonMap.set(video, button);
}

function getCachedMuteButton(video) {
    const button = muteButtonMap.get(video);
    if (!button || !isReusableMuteButton(button, video)) return null;
    return button;
}

function isReusableMuteButton(button, video) {
    if (!button.isConnected || !isVisibleElement(button)) return false;

    const label = getElementLabel(button);
    if (label && isUnsafeControlLabel(label)) return false;

    return isNearRect(button.getBoundingClientRect(), getAudioSearchRect(video), 260);
}

function isManualMuteButton(button, video) {
    const cachedButton = muteButtonMap.get(video);
    if (cachedButton && (button === cachedButton || cachedButton.contains(button) || button.contains(cachedButton))) {
        return true;
    }

    if (!isReusableMuteButton(button, video)) return false;

    const label = getElementLabel(button);
    return isAudioToggleLabel(label);
}

function getAudioSearchRect(video) {
    const storyContainer = getActiveStoryContainer();
    if (storyContainer) return storyContainer.getBoundingClientRect();
    return video.getBoundingClientRect();
}

function addMuteButtonCandidate(candidates, seen, element, score) {
    if (seen.has(element)) return;
    seen.add(element);
    candidates.push({ element, score });
}

function activateControl(element) {
    const options = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new PointerEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.dispatchEvent(new MouseEvent("click", options));
}

function getVideoScopes(video) {
    const scopes = [
        getActiveStoryContainer(),
        video.closest("article"),
        video.closest("div[role='dialog']"),
        video.closest("div[role='presentation']"),
        video.closest("section"),
        video.parentElement,
        document
    ];

    return Array.from(new Set(scopes.filter(Boolean)));
}

function getActiveStoryContainer() {
    if (!location.pathname.includes("/stories/")) return null;

    return Array.from(document.querySelectorAll("div.x5yr21d.x1n2onr6.xh8yej3"))
        .find((element) => element.parentElement?.clientHeight > 500) || null;
}

function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none";
}

function isNearRect(candidateRect, targetRect, padding) {
    return candidateRect.right >= targetRect.left - padding &&
        candidateRect.left <= targetRect.right + padding &&
        candidateRect.bottom >= targetRect.top - padding &&
        candidateRect.top <= targetRect.bottom + padding;
}

function getElementLabel(element) {
    const parts = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.textContent,
        ...Array.from(element.querySelectorAll("title")).map((title) => title.textContent)
    ];

    return parts.filter(Boolean).join(" ").toLowerCase();
}

function isAudioToggleLabel(label) {
    return label.includes("mute") ||
        label.includes("unmute") ||
        label.includes("audio") ||
        label.includes("sound") ||
        label.includes("volume") ||
        label.includes("speaker") ||
        label.includes("звук") ||
        label.includes("аудио") ||
        label.includes("аудіо");
}

function isPlaybackOrNavigationLabel(label) {
    return label.includes("play") ||
        label.includes("pause") ||
        label.includes("next") ||
        label.includes("previous") ||
        label.includes("close") ||
        label.includes("пауза") ||
        label.includes("воспроиз") ||
        label.includes("відтвор") ||
        label.includes("далее") ||
        label.includes("назад") ||
        label.includes("далі");
}

function isUnsafeControlLabel(label) {
    return isPlaybackOrNavigationLabel(label) ||
        label.includes("more") ||
        label.includes("options") ||
        label.includes("menu") ||
        label.includes("emoji") ||
        label.includes("comment") ||
        label.includes("ещё") ||
        label.includes("еще") ||
        label.includes("більше") ||
        label.includes("меню") ||
        label.includes("комментар") ||
        label.includes("коментар") ||
        label.includes("эмод") ||
        label.includes("емод");
}

function getAudioToggleScore(label) {
    if (label.includes("mute") || label.includes("unmute")) return 0;
    if (label.includes("звук")) return 0;
    if (label.includes("audio") || label.includes("sound") || label.includes("volume") || label.includes("speaker")) return 1;
    return 2;
}

function getDistanceScore(candidateRect, targetRect) {
    const candidateX = candidateRect.left + candidateRect.width / 2;
    const candidateY = candidateRect.top + candidateRect.height / 2;
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;
    return Math.hypot(candidateX - targetX, candidateY - targetY) / 1000;
}

function debugMuteCandidates(video, reason, selectedElement = null) {
    if (!isMuteDebugEnabled()) return;

    const searchRect = getAudioSearchRect(video);
    const candidates = [];

    getVideoScopes(video).forEach((scope) => {
        scope.querySelectorAll("button, div[role='button']").forEach((element) => {
            if (!isVisibleElement(element)) return;

            const rect = element.getBoundingClientRect();
            if (!isNearRect(rect, searchRect, 280)) return;

            candidates.push({
                selected: element === selectedElement,
                label: getElementLabel(element),
                audioLabel: isAudioToggleLabel(getElementLabel(element)),
                unsafeLabel: isUnsafeControlLabel(getElementLabel(element)),
                html: element.outerHTML.slice(0, 240),
                rect: {
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                }
            });
        });
    });

    debugMute(reason, {
        selected: selectedElement ? describeElement(selectedElement) : null,
        candidates
    });
}

function debugMute(message, data = {}) {
    if (!isMuteDebugEnabled()) return;
    console.info("[IGP_MUTE_DEBUG]", message, data);
}

function isMuteDebugEnabled() {
    try {
        return localStorage.getItem("instagramPlusMuteDebug") === "1";
    } catch (error) {
        return false;
    }
}

function describeElement(element) {
    if (!element) return null;

    const rect = element.getBoundingClientRect?.();
    return {
        tag: element.tagName?.toLowerCase(),
        label: getElementLabel(element),
        className: typeof element.className === "string" ? element.className : "",
        html: element.outerHTML?.slice(0, 240) || "",
        rect: rect ? {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        } : null
    };
}

function normalizeSeconds(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.min(number, 600);
}

function clampVolume(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
}

function runWhenDocumentReady(callback) {
    if (document.body) {
        callback();
        return;
    }

    document.addEventListener("DOMContentLoaded", callback, { once: true });
}

function migrateVolumeValue(data) {
    if (data.instVolumeScale === "percent") return;

    const oldValue = data.instdecreasevolume_value;
    const nextValue = oldValue === undefined
        ? settings.instdecreasevolume_value
        : clampVolume(Number(oldValue) / 10);

    data.instdecreasevolume_value = nextValue;
    data.instVolumeScale = "percent";
    chrome.storage.local.set({
        instdecreasevolume_value: nextValue,
        instVolumeScale: "percent"
    });
}
