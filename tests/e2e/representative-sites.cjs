const representativeSites = [
  {
    siteId: "javascript-course-docs",
    defaultSource: "github:metyatech/javascript-course-docs#master",
    e2ePort: 3102,
    e2eSourceEnv: "E2E_JAVASCRIPT_CONTENT_SOURCE",
  },
  {
    siteId: "programming-course-docs",
    defaultSource: "github:metyatech/programming-course-docs#master",
    e2ePort: 3101,
    e2eSourceEnv: "E2E_PROGRAMMING_CONTENT_SOURCE",
  },
];

module.exports = { representativeSites };
