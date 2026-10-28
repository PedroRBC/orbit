export const youtubeSelectors = {
  cards: "ytd-rich-item-renderer, yt-lockup-view-model",
  title: "a#video-title-link, a#video-title, a.yt-lockup-metadata-view-model__title",
  link: 'a[href*="/watch?v="]',
  author: "ytd-channel-name a, #channel-name a, .yt-content-metadata-view-model__metadata-row a",
  duration: "ytd-thumbnail-overlay-time-status-renderer span, .yt-badge-shape__text",
  ad: "ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-promoted-video-renderer",
  account: "#avatar-btn",
  challenge: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], #captcha-form, #challenge-form',
} as const;
