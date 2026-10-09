const external = { target: '_blank', rel: 'noopener noreferrer' }

/** 每个页面底部的政策链接和备案号（备案号按规定链到工信部查询）。 */
export function SiteFooter() {
  return <footer className="site-info">
    <p>
      <a href="https://xjdao.xyz/doc/%E4%B9%A1%E5%BB%BADAO-%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96.pdf" {...external}>隐私政策</a>
      {' • '}
      <a href="https://xjdao.xyz/doc/%E4%B9%A1%E5%BB%BADAO-%E7%94%A8%E6%88%B7%E6%9C%8D%E5%8A%A1%E5%8D%8F%E8%AE%AE.pdf" {...external}>服务条款</a>
    </p>
    <p><a href="https://beian.miit.gov.cn/" {...external}>京ICP备2025136647号</a></p>
  </footer>
}
