import { APP_VERSION } from '~/lib/version'

const external = { target: '_blank', rel: 'noopener noreferrer' }

/** 每个页面底部的政策链接和备案号（备案号按规定链到工信部查询）。 */
export function SiteFooter() {
  return <footer className="site-info">
    <p>
      <a href="/doc/privacy.pdf" {...external}>隐私政策</a>
      {' • '}
      <a href="/doc/terms.pdf" {...external}>服务条款</a>
    </p>
    <p><a href="https://beian.miit.gov.cn/" {...external}>京ICP备2025136647号</a></p>
    <p className="muted">版本 {APP_VERSION}</p>
  </footer>
}
