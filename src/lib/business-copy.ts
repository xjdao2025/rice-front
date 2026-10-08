// Rice may return older system-generated wording in saved history and notifications.
export function businessCopy(text: string) {
  return text
    .replace(/^收款人不存在[。]?$/, '没找到这位伙伴，再核对一下账号。')
    .replace(/(^| · )活动申请已通过$/, '$1报名通过')
    .replace(/报名费\s+(\d+)\s+稻米/g, '报名的 $1 稻米')
    .replaceAll('报名费', '报名稻米')
    .replaceAll('所属社区', '所属节点')
    .replaceAll('社区账户', '节点账户')
    .replaceAll('向社区退回', '向节点退还')
    .replaceAll('向发布者退回', '向发布者退还')
    .replaceAll('稻米已退还', '稻米已退回')
    .replaceAll('稻米报酬', '稻米激励')
    .replaceAll('内容打赏', '内容赞赏')
    .replaceAll('收款人', '稻米接收人')
    .replaceAll('金额必须', '稻米数量必须')
}
