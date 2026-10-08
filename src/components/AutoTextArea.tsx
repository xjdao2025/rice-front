import { TextArea as AstryxTextArea, type TextAreaProps } from '@astryxdesign/core/TextArea'
import { useLayoutEffect, useRef } from 'react'

export function resizeTextArea(element: HTMLTextAreaElement) {
  if (!element.clientWidth) return
  const style = getComputedStyle(element)
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)}px`
}

export function TextArea({ rows = 1, ...props }: Omit<TextAreaProps, 'ref'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => { if (ref.current) resizeTextArea(ref.current) }, [props.value, rows])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let width = element.clientWidth
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return
      width = entry.contentRect.width
      resizeTextArea(element)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <AstryxTextArea {...props} className={`auto-text-area ${props.className ?? ''}`} rows={rows} ref={ref} />
}
