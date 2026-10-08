import { Button } from '@astryxdesign/core/Button'
import { Grid } from '@astryxdesign/core/Grid'
import { IconButton } from '@astryxdesign/core/IconButton'
import { ChevronLeft, ChevronRight, ImagePlus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT, imageSizeLabel, validateImageFiles } from '~/lib/images'
import '~/styles/images.css'

export type PreviewImage = { src: string; alt: string; fullsize?: string }

function ContentImage({ src, alt, loading, canRetry = false }: PreviewImage & { loading?: 'lazy'; canRetry?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (failed) return <span className="content-image-failure" role="status">
    <span>图片暂时无法加载</span>
    {canRetry && <Button label="重试" variant="secondary" onClick={() => { setFailed(false); setAttempt(attempt + 1) }} />}
  </span>
  return <img key={attempt} src={src} alt={alt} loading={loading} onError={() => setFailed(true)} />
}

export function ImageGroup({ images, className = '' }: { images: PreviewImage[]; className?: string }) {
  const [selected, setSelected] = useState<number | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  if (!images.length) return null
  return <>
    <Grid columns={images.length === 4 ? 2 : Math.min(images.length, 3)} className={`content-image-group ${className}`} aria-label="图片">
      {images.map((image, index) => <button type="button" className="content-image-thumbnail" key={`${image.src}:${index}`} aria-label={`查看第 ${index + 1} 张图片${image.alt ? `：${image.alt}` : ''}`} onClick={(event) => { opener.current = event.currentTarget; setSelected(index) }}><ContentImage {...image} loading="lazy" /></button>)}
    </Grid>
    {selected !== null && <ImageViewer images={images} initialIndex={selected} opener={opener.current} onClose={() => setSelected(null)} />}
  </>
}

function ImageViewer({ images, initialIndex, opener, onClose }: { images: PreviewImage[]; initialIndex: number; opener: HTMLButtonElement | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const [index, setIndex] = useState(initialIndex)
  const currentIndex = Math.min(index, images.length - 1)
  const image = images[currentIndex]
  const move = (delta: number) => setIndex(Math.max(0, Math.min(images.length - 1, currentIndex + delta)))
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { dialog?.close(); opener?.focus({ preventScroll: true }) }
  }, [opener])
  return createPortal(<dialog ref={dialogRef} className="content-image-viewer" aria-label="查看图片"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1) } }}>
    <div className="content-image-stage" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      onTouchStart={(event) => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY } }}
      onTouchEnd={(event) => {
        const start = touchStart.current
        touchStart.current = null
        if (!start) return
        const dx = event.changedTouches[0].clientX - start.x
        const dy = event.changedTouches[0].clientY - start.y
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? -1 : 1)
      }}>
      <ContentImage key={image.fullsize ?? image.src} src={image.fullsize ?? image.src} alt={image.alt || `第 ${currentIndex + 1} 张图片`} canRetry />
    </div>
    <IconButton className="content-image-control content-image-close" label="关闭图片" icon={<X size={22} />} variant="ghost" onClick={onClose} />
    {images.length > 1 && <>
      <div className="content-image-pager" aria-hidden="true">{images.map((_, dot) => <span key={dot} className={dot === currentIndex ? 'is-current' : ''} />)}</div>
      {currentIndex > 0 && <IconButton className="content-image-control content-image-previous" label="上一张" icon={<ChevronLeft size={24} />} variant="ghost" onClick={() => move(-1)} />}
      {currentIndex < images.length - 1 && <IconButton className="content-image-control content-image-next" label="下一张" icon={<ChevronRight size={24} />} variant="ghost" onClick={() => move(1)} />}
      <span className="content-image-status" role="status">第 {currentIndex + 1} 张，共 {images.length} 张</span>
    </>}
  </dialog>, document.body)
}

export function ImagePicker({ images, onSelect, onRemove, disabled = false }: {
  images: PreviewImage[]
  onSelect: (files: File[]) => void
  onRemove: (index: number) => void
  disabled?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const full = images.length >= MAX_IMAGE_COUNT
  return <section className="content-image-picker" aria-label="添加图片">
    <label className="content-image-picker-label" htmlFor={id}>图片（选填）</label>
    {!!images.length && <div className="content-image-previews">{images.map((image, index) => <div className="content-image-preview" key={`${image.src}:${index}`}><img src={image.src} alt={image.alt} /><button type="button" className="content-image-remove" aria-label={`移除第 ${index + 1} 张图片`} disabled={disabled} onClick={() => { setError(null); onRemove(index) }}><X size={20} /></button></div>)}</div>}
    <label className={`content-image-add${disabled || full ? ' is-disabled' : ''}`}><ImagePlus size={22} /><span>{full ? `已添加 ${MAX_IMAGE_COUNT} 张图片` : '添加图片'}</span><input id={id} type="file" accept={IMAGE_ACCEPT} multiple disabled={disabled || full} aria-label="添加图片" aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} onChange={(event) => {
      const files = Array.from(event.currentTarget.files || [])
      event.currentTarget.value = ''
      if (!files.length) return
      const failure = validateImageFiles(files, images.length)
      setError(failure)
      if (!failure) onSelect(files)
    }} /></label>
    <p id={helpId} className="content-image-help">最多 {MAX_IMAGE_COUNT} 张，大图自动压缩到 {imageSizeLabel(MAX_IMAGE_BYTES)} 以内（GIF 除外）。</p>
    {error && <p id={errorId} className="content-image-error" role="alert">{error}</p>}
  </section>
}
