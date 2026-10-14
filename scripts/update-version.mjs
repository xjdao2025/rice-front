#!/usr/bin/env node
// 更新前端版本号:把 HEAD 的提交日期写进 src/lib/version.ts
//
//   pnpm version:update           # 用最后一次提交的日期
//   pnpm version:update 2026-10-20   # 指定日期
//
// 版本号是编译进包里的常量(页面上不多一次请求),所以发版前跑一下;
// 它记的是「这版包含的最后一个改动是哪天」,不含这次改版本号本身。

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = join(root, 'src/lib/version.ts')

const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim()

const version = process.argv[2] || git('log', '-1', '--format=%cs')

if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
  console.error(`版本号要写成 YYYY-MM-DD,拿到的是 ${JSON.stringify(version)}`)
  process.exit(1)
}

// 工作区有没提交的改动时,这个日期不含它们 —— 提醒一句,不拦
if (!process.argv[2] && git('status', '--porcelain')) {
  console.error('注意:工作区有未提交的改动,这个日期只到今天为止的提交。')
}

const source = readFileSync(target, 'utf8')
const updated = source.replace(/APP_VERSION = '.*'/, `APP_VERSION = '${version}'`)

if (updated === source) {
  console.log(`版本号没变:${version}`)
} else {
  writeFileSync(target, updated)
  console.log(`前端版本号 → ${version}`)
}