export const valeteSelectors = {
  cards: "article",
  postText: 'a[href^="/p/"] .whitespace-break-spaces, a[href^="/post/"] .whitespace-break-spaces',
  articleLink: 'a[href^="/a/"]',
  author: 'a[href^="/u/"] p',
  permalinks: 'a[href^="/a/"], a[href^="/p/"], a[href^="/post/"], a[href^="https://app.valete.org.br/a/"], a[href^="https://app.valete.org.br/p/"], a[href^="https://app.valete.org.br/post/"]',
  account: "body",
  challenge: '#challenge-form, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]',
} as const;
