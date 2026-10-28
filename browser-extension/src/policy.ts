import { platformRequestRoots, readPostPatterns, mediaPathPattern } from "../../src/collectors/browser";
import type { BrowserPlatform } from "../../src/collectors/types";

const mutations = ["like", "unlike", "subscribe", "unsubscribe", "comment", "follow", "unfollow", "FavoriteTweet", "UnfavoriteTweet", "CreateTweet", "DeleteTweet", "CreateRetweet", "DeleteRetweet"];
export function captureRules(tabId: number, platform: BrowserPlatform): chrome.declarativeNetRequest.Rule[] {
  const action = chrome.declarativeNetRequest.RuleActionType;
  const resource = chrome.declarativeNetRequest.ResourceType;
  const method = chrome.declarativeNetRequest.RequestMethod;
  const rules: chrome.declarativeNetRequest.Rule[] = [
    { id: 1, priority: 1, action: { type: action.BLOCK }, condition: { tabIds: [tabId], urlFilter: "*" } },
    { id: 2, priority: 2, action: { type: action.ALLOW }, condition: { tabIds: [tabId], requestDomains: platformRequestRoots[platform], requestMethods: [method.GET, method.HEAD, method.OPTIONS], regexFilter: "^https://" } },
    { id: 3, priority: 10, action: { type: action.BLOCK }, condition: { tabIds: [tabId], resourceTypes: [resource.IMAGE, resource.MEDIA, resource.FONT, resource.WEBSOCKET, resource.SUB_FRAME] } },
    { id: 4, priority: 10, action: { type: action.BLOCK }, condition: { tabIds: [tabId], regexFilter: mediaPathPattern, isUrlFilterCaseSensitive: false } },
    // Filtros literais evitam exceder o limite de memória das regexes do Chrome.
    ...mutations.map((name, index) => ({ id: 100 + index, priority: 10, action: { type: action.BLOCK }, condition: { tabIds: [tabId], urlFilter: `/${name}`, isUrlFilterCaseSensitive: false, resourceTypes: [resource.XMLHTTPREQUEST, resource.MAIN_FRAME, resource.SUB_FRAME, resource.OTHER] } })),
  ];
  const post = readPostPatterns[platform];
  if (post) rules.push({ id: 6, priority: 2, action: { type: action.ALLOW }, condition: { tabIds: [tabId], requestMethods: [method.POST], regexFilter: post } });
  return rules;
}
export const captureRuleIds = [1, 2, 3, 4, 5, 6, ...mutations.map((_name, index) => 100 + index)];
