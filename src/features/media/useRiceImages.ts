import { useCallback, useEffect, useRef, useState } from 'react'
import { attachmentImages } from '~/lib/attachments'
import { prepareImage, readFileBase64 } from '~/lib/images'
import type { RiceAttachment } from '~/lib/models'
import { uploadRiceAttachment } from '../account/api'

type SelectedImage = { src: string; alt: string; file?: File; attachment?: RiceAttachment }

export async function uploadImageSelection(
  images: SelectedImage[],
  uploaded: WeakMap<File, RiceAttachment>,
  upload: (file: File) => Promise<RiceAttachment>,
) {
  const ids: string[] = []
  for (const image of images) {
    let attachment = image.attachment ?? (image.file && uploaded.get(image.file))
    if (!attachment && image.file) {
      attachment = await upload(await prepareImage(image.file))
      uploaded.set(image.file, attachment)
    }
    if (!attachment) throw new Error('图片读取失败，请重新选择。')
    ids.push(attachment.id)
  }
  return ids
}

export function useRiceImages(initialAttachments: RiceAttachment[] = []) {
  const [images, setImages] = useState<SelectedImage[]>(() => attachmentImages(initialAttachments).map((image, index) => ({ ...image, attachment: initialAttachments[index] })))
  const urls = useRef(new Set<string>())
  const uploaded = useRef(new WeakMap<File, RiceAttachment>())
  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current.clear() }, [])
  const restore = useCallback((attachments: RiceAttachment[]) => {
    setImages(attachmentImages(attachments).map((image, index) => ({ ...image, attachment: attachments[index] })))
  }, [])
  const select = (files: File[]) => {
    const additions = files.map((file) => {
      const src = URL.createObjectURL(file)
      urls.current.add(src)
      return { src, alt: file.name, file }
    })
    setImages((current) => [...current, ...additions])
  }
  const remove = (index: number) => setImages((current) => current.filter((_, i) => i !== index))
  const upload = (token: string) => uploadImageSelection(images, uploaded.current, async (file) =>
    uploadRiceAttachment({ data: { token, filename: file.name, contentType: file.type, base64: await readFileBase64(file) } }),
  )
  return { images, select, remove, restore, upload }
}
