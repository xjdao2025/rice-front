# rice-front 约定

项目结构、页面职责和设计取舍见 [README.md](README.md)。

## 版本号

页脚显示的版本是**编译进包里的常量**（`src/lib/version.ts` 的 `APP_VERSION`），页面上不会因此多一次请求。
格式是 `1.<提交序号>+<YYYY-MM-DD>`，例如 `1.142+2026-10-18`。序号用 `git log --oneline | wc -l`，日期是 Asia/Shanghai 的当天。

`scripts/githooks/pre-commit` 在每次提交时写入并 `git add`。新提交还没进 log，所以序号是 wc 再加 1；`git commit --amend` 不再加 1。**不要手改，构建前也不用再跑脚本。** 本仓库需要：

```bash
git config core.hooksPath scripts/githooks
```

只显示前端版本，后端版本另有其事。