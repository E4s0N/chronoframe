import { getStorageManager } from '~~/server/plugins/3.storage'

// 简单的Content-Type猜测函数
const guessContentType = (filePath: string): string => {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

export default defineEventHandler(async (event) => {
  const imageName = getRouterParam(event, 'imageName')
  if (!imageName) {
    throw createError({ statusCode: 400, statusMessage: 'Image name is required' })
  }

  // 检查图片名称是否有效（防止路径穿越）
  if (imageName.includes('..') || imageName.includes('/') || imageName.includes('\\')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid image name' })
  }

  const manager = getStorageManager()
  const provider = manager.getProvider()

  try {
    // 尝试从存储提供者获取打印图片
    const printKey = `print/${imageName}`
    const imageBuffer = await provider.get(printKey)
    
    if (!imageBuffer) {
      throw new Error('Print image not found in storage')
    }
    
    setHeader(event, 'Content-Type', guessContentType(imageName))
    setHeader(event, 'Content-Length', imageBuffer.length)
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
    
    return imageBuffer
  } catch (error) {
    // 图片不存在，返回404
    throw createError({ 
      statusCode: 404, 
      statusMessage: 'Print image not found. It may still be processing or the source image does not exist.',
      data: {
        imageName,
        providerType: (provider as any).config?.provider,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }
})