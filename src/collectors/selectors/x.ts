export const xSelectors = {
  cards: 'article[data-testid="tweet"]',
  text: '[data-testid="tweetText"]',
  author: '[data-testid="User-Name"] a span',
  time: "a[href*='/status/'] time",
  photo: '[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media/"]',
  likes: '[data-testid="like"], [data-testid="unlike"]',
  replies: '[data-testid="reply"]',
  reposts: '[data-testid="retweet"], [data-testid="unretweet"]',
  ad: '[data-testid="placementTracking"], [data-testid="promotedIndicator"]',
  account: '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Profile_Link"]',
  challenge: '#challenge-form, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]',
} as const;
