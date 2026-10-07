({
  request: {
    url: "{{baseUrl}}/rate_limit",
    method: "GET",
    headers: "{{apiKey}}" ? {Authorization: "Bearer {{apiKey}}", "X-GitHub-Api-Version": "2022-11-28"} : {"X-GitHub-Api-Version": "2022-11-28"}
  },
  extractor: function(response) {
    var core = response.resources.core;
    return {planName: "GitHub API", remaining: core.remaining, used: core.limit - core.remaining, total: core.limit, unit: "次", resetsAt: new Date(core.reset * 1000).toISOString()};
  }
})
