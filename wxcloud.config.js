/**
 * 微信云托管 CLI（@wxcloud/cli）项目配置
 * 文档：https://cloud.weixin.qq.com/cli/features/config.html
 */
module.exports = {
  type: "run",
  server: {
    port: 8000,
    buildDir: ".",
    versionRemark: "baidu_easydl_proxy-flask",
  },
};
