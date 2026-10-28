export const instagramSelectors = {
  cards: "article",
  link: 'a[href*="/p/"] time, a[href*="/reel/"] time',
  fallbackLink: 'a[href^="/p/"], a[href^="/reel/"]',
  author: "header a[href], a.notranslate[href]",
  caption: 'h1, [data-testid="post-caption"], [data-testid="caption"]',
  captionByAuthor: 'span._aacu[dir="auto"]',
  image: "img[src]",
  likes: '[data-testid="like-count"]',
  ad: '[data-testid="ad-label"], [data-sponsored="true"]',
  account: 'a[href^="/direct/inbox"], a[href^="/accounts/edit"], svg[aria-label="Seu perfil"], svg[aria-label="Your profile"]',
  challenge: 'form[action*="challenge"], #challenge-form, iframe[src*="recaptcha"], input[autocomplete="one-time-code"]',
} as const;
