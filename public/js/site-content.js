/* 站点公共内容默认配置（公告栏 + 法律声明栏）
 * 管理后台可在「系统设置」中覆盖；前端仅渲染此配置或 /api/site-content 返回的数据。 */
(function () {
  'use strict';

  window.SITE_CONTENT = {
    announcements: [
      {
        id: 'matrix-launch-20260807',
        title: '矩阵数据功能上线：支持成绩上传、筛选与数据详情',
        content:
          '矩阵数据库现已上线，支持上传当期矩阵成绩（本人/代传）、按赛季·阶段·当期增益·轮次筛选，并可查看队伍配置、武器与声骸详情。上传数据需登录，禁止虚报成绩，欢迎监督举报。',
        time: '2026-08-07',
      },
      {
        id: 'announce-20260806',
        title: '网页版与本地版数据已同步，公开方案库支持分享码检索',
        content:
          '公开数据库已支持按分享码精确检索轴方案，上传多配置数据会自动分批展示；个人主页新增草稿箱与云端方案库，改稿后重新上传即可覆盖更新。',
        time: '2026-08-06',
      },
    ],
    footer: {
      brand: '鸣算屋 · WaveCalc',
      copyright: '© 2026 鸣算屋 WaveCalc',
      statements: [
        '本站为《鸣潮》玩家自制的伤害计算与数据交流工具，与游戏官方无关；所有数值仅供参考，请以游戏内实际表现为准。',
        '本地源码版不提供在线上传与账号服务。',
      ],
      links: [
        { label: '隐私政策', href: 'privacy.html' },
        { label: '用户协议', href: 'terms.html' },
        { label: '版权声明', href: 'copyright.html' },
      ],
    },
  };
})();
