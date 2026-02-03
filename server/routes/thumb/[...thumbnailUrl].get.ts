import sharp from 'sharp'

export default eventHandler(async (event) => {
  const { storageProvider } = useStorageProvider(event)

  let url = getRouterParam(event, 'thumbnailUrl')

  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid thumbnailUrl' })
  }

  url = decodeURIComponent(url)

  // 对于本地存储提供者，直接从文件系统读取而不是通过HTTP请求
  if (storageProvider.config?.provider === 'local' && url.startsWith('/storage/')) {
    try {
      // 移除 /storage/ 前缀获取相对路径
      const relativePath = url.substring('/storage/'.length)
      
      // 使用存储提供者的get方法直接读取文件
      const fileBuffer = await storageProvider.get(relativePath)
      
      if (!fileBuffer) {
        throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
      }

      // 处理图像并返回
      const sharpInst = sharp(fileBuffer).rotate()
      return await sharpInst.jpeg({ quality: 85 }).toBuffer()
    } catch (error) {
      console.error('Error reading local file:', error)
      throw createError({ 
        statusCode: 500, 
        statusMessage: 'Failed to process thumbnail' 
      })
    }
  }

  // 对于非本地存储提供者，使用原有的fetch方式
  const photo = await fetch(url)
    .then((res) => {
      if (!res.ok) {
        throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
      }
      return res.arrayBuffer()
    })
    .then((buf) => Buffer.from(buf))

  const sharpInst = sharp(photo).rotate()
  return await sharpInst.jpeg({ quality: 85 }).toBuffer()
})