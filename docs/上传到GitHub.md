# 用GitHub Desktop上传

只操作本交付包里的repository目录；不要选择原开发项目，也不要选择包含快照、审查报告和临时脚本的上级目录。

## 第一次上传

首次提交前，先保护提交者信息：在GitHub网页的Settings → Emails勾选Keep my email addresses private，复制页面显示的GitHub noreply邮箱。GitHub Desktop添加仓库后，在Repository → Repository settings → Git Config选择Use a local Git config，Name使用你愿意公开的昵称，Email使用刚复制的noreply邮箱，然后保存。只勾选网页邮箱隐私不会自动改掉电脑上已有的Git邮箱；第一次Commit前就要检查。不要在公开提交中填写真实姓名或私人邮箱。

官方说明：[提交邮箱](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)、[Desktop仓库级作者配置](https://docs.github.com/en/desktop/configuring-and-customizing-github-desktop/configuring-git-for-github-desktop)。

1. 注册或登录GitHub账号，安装并打开 [GitHub Desktop](https://desktop.github.com/)。
2. 可直接使用已整理好的repository目录；也可解压源码ZIP到一个新目录。无需先运行setup就能上传。
3. 在GitHub Desktop选择 File → Add local repository，选择解压后的repository目录。
4. 如果提示该目录不是Git仓库，点击create a repository here；在原目录创建，别再新建一层空目录。Git ignore和License选None，保留包内已有文件。
5. 左侧Changes应该主要是public源码、scripts和说明文件。确认没有.env、用户方案、backups、memory、csf或大型图片/模型。后续运行setup恢复的资源已被.gitignore排除。
6. Summary填写“发布非商业源码公开版”，点击Commit to main。
7. 点击Publish repository。Name建议wuwacalc；Description填写“鸣潮配队伤害计算器｜非商业源码公开”。第一次先勾选Keep this code private，再Publish。
8. 打开网页仓库，检查README、LICENSE和NOTICE。确认没有个人资料，能从干净目录按说明运行。
9. 准备公开时，在网页Settings → General → Danger Zone → Change repository visibility改为Public，按GitHub提示确认。公开后他人已有副本无法收回。

官方步骤：[添加已有项目](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop)。不同界面版本的文字可能稍有差异。

## 保留你的审核和发布权

- 不给陌生人仓库写权限。普通贡献者通过Fork和PR提交修改。
- Settings → Rules → Rulesets（或Branches保护规则）为main配置“必须通过PR”，多人协作时再要求维护者审核。只你一人时，不要设置你无法满足的他人审核数量；PR作者不能批准自己的PR。
- 如有其他写权限协作者，审核规则必须限定维护者/Code Owner，不能认为任何一次Approve都是站长同意。
- 不配置自动生产部署，不把生产密钥加到仓库或GitHub Actions。正式站仍按原门禁、备份、增量合入和人工发布流程处理。
- 在Security设置里启用私密漏洞报告；开启Issue接收反馈。

## 后续更新

在这个独立仓库中修改、检查、Commit，然后Push origin。外部PR先审查和本地验收，再决定是否Merge。GitHub合入和正式站发布是两个独立步骤。

不要直接将整个正式网站或原开发目录复制覆盖此仓库。新版源码仍需明确基线、排除内部资料，并保留本地版与生产服务的隔离。
