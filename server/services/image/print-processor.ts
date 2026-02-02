import path from 'node:path'
import { promises as fs } from 'node:fs'
import sharp from 'sharp'
import qrcode from 'qrcode'
import type { Logger } from '~~/server/utils/logger'
import { extractExifData, extractPhotoInfo } from './exif'
import { getStorageManager } from '~~/server/plugins/3.storage'

export interface PrintPhotoParams {
  storageKey: string
  locationName: string
  logger?: Logger
}

export async function processPrintPhoto(params: PrintPhotoParams): Promise<void> {
  const { storageKey, locationName, logger = {} as Logger } = params
  const storageProvider = getStorageManager().getProvider()

  logger.image?.info(`Start processing print photo: ${storageKey}`)

  try {
    // 获取原始图片
    const originalBuffer = await storageProvider.get(storageKey)
    if (!originalBuffer) {
      throw new Error(`Original image not found: ${storageKey}`)
    }

    // 先从原始图片中提取EXIF数据，避免在格式转换时丢失
    logger.image?.info('Extracting EXIF data from original image...')
    const exifData = await extractExifData(originalBuffer, originalBuffer, logger.image)
    const photoInfo = extractPhotoInfo(storageKey, exifData)

    // 然后再将图片转换为JPEG格式进行处理
    logger.image?.info('Converting image to JPEG format for compatibility...')
    const jpegBuffer = await sharp(originalBuffer)
      .jpeg({ quality: 90, progressive: true, exif: true }) // 添加exif: true选项保留EXIF数据
      .toBuffer()

    // 使用转换后的JPEG图片进行处理
    const sharpInst = sharp(jpegBuffer)
    const metadata = await sharpInst.metadata()

    if (!metadata.width || !metadata.height) {
      throw new Error(`Could not get image dimensions: ${storageKey}`)
    }

    let width = metadata.width
    let height = metadata.height
    const aspectRatio = width / height

    let processedImage = sharpInst
    let isPortrait = aspectRatio < 1

    // 根据图片方向处理
    if (isPortrait) {
      logger.image?.info('Rotating portrait image...')
      // 竖排图片：逆时针旋转90度
      const rotatedBuffer = await processedImage
        .rotate(-90)
        .jpeg({ quality: 90 })
        .toBuffer()
      processedImage = sharp(rotatedBuffer)
      
      // 更新旋转后的尺寸
      const tempWidth = width
      const tempHeight = height
      width = tempHeight
      height = tempWidth
    }

    // 目标打印图片比例：3:2
    const targetPrintRatio = 3 / 2
    const currentRatio = width / height

    // 如果当前比例不是3:2，裁剪图片使其成为3:2
    if (Math.abs(currentRatio - targetPrintRatio) > 0.001) {
      logger.image?.info(`Original image ratio (${currentRatio.toFixed(2)}:1) is not 3:2, cropping...`)
      
      if (currentRatio > targetPrintRatio) {
        // 当前图片更宽，需要裁剪宽度
        const targetWidth = Math.round(height * targetPrintRatio)
        const leftOffset = Math.round((width - targetWidth) / 2)
        
        const croppedBuffer = await processedImage
          .extract({
            left: leftOffset,
            top: 0,
            width: targetWidth,
            height: height
          })
          .jpeg({ quality: 90 })
          .toBuffer()
        
        processedImage = sharp(croppedBuffer)
        width = targetWidth
      } else {
        // 当前图片更高，需要裁剪高度
        const targetHeight = Math.round(width / targetPrintRatio)
        const topOffset = Math.round((height - targetHeight) / 2)
        
        const croppedBuffer = await processedImage
          .extract({
            left: 0,
            top: topOffset,
            width: width,
            height: targetHeight
          })
          .jpeg({ quality: 90 })
          .toBuffer()
        
        processedImage = sharp(croppedBuffer)
        height = targetHeight
      }
    }

    // 计算水印条的高度
    // 目标整体宽高比为4:3
    const targetTotalHeight = Math.round(width * 3 / 4)
    const watermarkHeight = targetTotalHeight - height

    // 确保水印条有足够高度
    if (watermarkHeight <= 0) {
      // 如果水印条高度不足，强制调整图片高度
      const minWatermarkHeight = 50 // 最小水印条高度
      const maxImageHeight = Math.floor(width * 3 / 4) - minWatermarkHeight
      
      if (maxImageHeight > 0 && maxImageHeight < height) {
        logger.image?.info(`Adjusting image height for watermark...`)
        const topOffset = Math.round((height - maxImageHeight) / 2)
        
        const adjustedBuffer = await processedImage
          .extract({
            left: 0,
            top: topOffset,
            width: width,
            height: maxImageHeight
          })
          .jpeg({ quality: 90 })
          .toBuffer()
        
        processedImage = sharp(adjustedBuffer)
        height = maxImageHeight
      }
    }

    // 重新计算水印条高度
    const finalTargetHeight = Math.round(width * 3 / 4)
    const finalWatermarkHeight = finalTargetHeight - height

    // 提取图片的主体颜色（使用克隆的sharp实例，避免影响原图）
    logger.image?.info('Extracting dominant color from image...')
    const colorStats = await processedImage.clone() // 克隆实例避免影响原图
      .resize(100) // 缩小图片以提高处理速度
      .stats()
    
    // 使用颜色统计数据确定主体颜色
    const dominantColor = {
      r: Math.round(colorStats.channels[0].mean),
      g: Math.round(colorStats.channels[1].mean),
      b: Math.round(colorStats.channels[2].mean)
    }
    logger.image?.info(`Extracted dominant color: rgb(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b})`)
    
    // 计算颜色的相对亮度，判断使用白色还是黑色文字
    // 根据WCAG标准，相对亮度 > 0.5 时使用黑色文字，否则使用白色文字
    const r = dominantColor.r / 255
    const g = dominantColor.g / 255
    const b = dominantColor.b / 255
    
    // 相对亮度计算公式：L = 0.2126 * R + 0.7152 * G + 0.0722 * B
    const relativeLuminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    
    // 选择前景色：亮度 > 0.5 使用黑色，否则使用白色
    const foregroundColor = relativeLuminance > 0.5 ? 'black' : 'white'
    const foregroundColorHex = foregroundColor === 'black' ? '#000000' : '#ffffff'
    logger.image?.info(`Selected foreground color: ${foregroundColor} (relative luminance: ${relativeLuminance.toFixed(3)})`)

    logger.image?.info(`Creating watermark background (${width}x${finalWatermarkHeight})...`)
    // 创建水印条背景，使用主体颜色
    const watermarkBackground = await sharp({
      create: {
        width,
        height: finalWatermarkHeight,
        channels: 3,
        background: dominantColor
      }
    })
    .jpeg()
    .toBuffer()

    // 获取处理后的图片缓冲区
    logger.image?.info('Getting processed image buffer...')
    const processedImageBuffer = await processedImage
      .jpeg({ quality: 90 })
      .toBuffer()

    logger.image?.info('Combining image and watermark...')
    // 合并原始图片和水印条背景
    const combinedImage = await sharp(processedImageBuffer)
      // 扩展画布高度以容纳水印条
      .extend({
        bottom: finalWatermarkHeight,
        background: 'transparent'
      })
      // 将水印条合成到底部扩展区域
      .composite([
        { 
          input: watermarkBackground, 
          top: height, // 从原图高度开始放置水印条
          left: 0 
        }
      ])
      .jpeg({ quality: 90 })
      .toBuffer()

    // 准备水印文本
    // 格式化日期为 YYYY-MM-DD HH:mm:ss
    const dateTaken = photoInfo.dateTaken ? new Date(photoInfo.dateTaken).toISOString().replace('T', ' ').substring(0, 19) : ''
    const photographer = 'TK' // 默认摄影师
    const cameraModel = exifData?.Model || ''
    
    // 提取相机参数
    const focalLength = exifData?.FocalLength || ''
    const aperture = exifData?.FNumber ? `f/${exifData.FNumber}` : ''
    const exposureTime = exifData?.ExposureTime || ''
    const iso = exifData?.ISO || ''

    // 计算动态字体大小，保持与水印条高度的固定比例（约为水印条高度的1/4）
    const fontSize = Math.max(8, Math.round(finalWatermarkHeight / 4))
    logger.image?.info(`Calculated dynamic font size: ${fontSize}px (based on watermark height: ${finalWatermarkHeight}px)`)
    
    // 生成二维码
    logger.image?.info('Generating QR code...')
    
    // 从存储键中提取文件名（不带扩展名）
    const fileName = path.basename(storageKey, path.extname(storageKey))
    
    // 获取网站前缀（从环境变量或默认值）
    const runtimeConfig = useRuntimeConfig()
    const sitePrefix = runtimeConfig.SITE_URL || 'https://gallery.drtk.cn'
    logger.image?.info(`Using site prefix for QR code: ${sitePrefix}`)
    
    // 生成二维码内容：网站前缀 + 文件名（不带扩展名）
    const qrCodeContent = `${sitePrefix}/${fileName}`
    logger.image?.info(`QR code content: ${qrCodeContent}`)
    
    // 二维码大小不超过水印条高度减边距
    const qrCodeSize = finalWatermarkHeight - 20
    const qrCodeBuffer = await qrcode.toBuffer(qrCodeContent, {
      width: qrCodeSize,
      margin: 2,
      color: {
        dark: foregroundColorHex, // 二维码颜色使用前景色
        light: '#ffffff00' // 透明背景
      }
    })
    
    // 计算二维码位置（水印条中间）
    const qrCodeX = Math.round((width - qrCodeSize) / 2)
    const qrCodeY = height + Math.round((finalWatermarkHeight - qrCodeSize) / 2)
    
    // 计算边距（增加边距，使其与上边距一致）
    const margin = Math.round(fontSize * 0.8) // 增加边距，使用字体大小的倍数计算
    
    // 创建带有文本水印和二维码的最终图片，使用动态字体大小
    let finalImageWithoutExif = await sharp(combinedImage)
      .composite([
        // 二维码（放在中间）
        { 
          input: qrCodeBuffer, 
          top: qrCodeY, 
          left: qrCodeX, 
          blend: 'over' 
        },
        // 左上角：拍摄时间（根据背景色自动选择文字颜色）
        { 
          input: Buffer.from(`<svg width=\"${width}\" height=\"${finalTargetHeight}\">\n            <text x=\"${margin}\" y=\"${height + margin + fontSize}\" font-family=\"Arial\" font-size=\"${fontSize}\" fill=\"${foregroundColor}\" stroke=\"${foregroundColor === 'white' ? 'black' : 'white'}\" stroke-width=\"1\" paint-order=\"stroke fill\">${dateTaken}</text>\n          </svg>`), 
          top: 0, 
          left: 0, 
          blend: 'over' 
        },
        // 右上角：拍摄地点（根据背景色自动选择文字颜色）
        { 
          input: Buffer.from(`<svg width=\"${width}\" height=\"${finalTargetHeight}\">\n            <text x=\"${width - margin}\" y=\"${height + margin + fontSize}\" font-family=\"Arial\" font-size=\"${fontSize}\" fill=\"${foregroundColor}\" stroke=\"${foregroundColor === 'white' ? 'black' : 'white'}\" stroke-width=\"1\" paint-order=\"stroke fill\" text-anchor=\"end\">${locationName}</text>\n          </svg>`), 
          top: 0, 
          left: 0, 
          blend: 'over' 
        },
        // 左下角：摄影师信息（根据背景色自动选择文字颜色）
        { 
          input: Buffer.from(`<svg width=\"${width}\" height=\"${finalTargetHeight}\">\n            <text x=\"${margin}\" y=\"${height + finalWatermarkHeight - margin}\" font-family=\"Arial\" font-size=\"${fontSize}\" fill=\"${foregroundColor}\" stroke=\"${foregroundColor === 'white' ? 'black' : 'white'}\" stroke-width=\"1\" paint-order=\"stroke fill\">Photo by ${photographer} with ${cameraModel}</text>\n          </svg>`), 
          top: 0, 
          left: 0, 
          blend: 'over' 
        },
        // 右下角：相机参数（根据背景色自动选择文字颜色）
        { 
          input: Buffer.from(`<svg width=\"${width}\" height=\"${finalTargetHeight}\">\n            <text x=\"${width - margin}\" y=\"${height + finalWatermarkHeight - margin}\" font-family=\"Arial\" font-size=\"${fontSize}\" fill=\"${foregroundColor}\" stroke=\"${foregroundColor === 'white' ? 'black' : 'white'}\" stroke-width=\"1\" paint-order=\"stroke fill\" text-anchor=\"end\">${focalLength} ${aperture} ${exposureTime} ISO${iso}</text>\n          </svg>`), 
          top: 0, 
          left: 0, 
          blend: 'over' 
        }
      ])
      .toBuffer()

    // 如果是竖排图片，顺时针旋转90度恢复方向
    if (isPortrait) {
      logger.image?.info('Rotating back to portrait orientation...')
      finalImageWithoutExif = await sharp(finalImageWithoutExif)
        .rotate(90)
        .toBuffer()
    }

    // 将原始EXIF信息应用到最终图像上
    logger.image?.info('Applying original EXIF data to final image...')
    
    // 获取原始图像的EXIF数据
    const originalMetadata = await sharp(originalBuffer).metadata();
    if (originalMetadata.exif) {
      // 由于sharp无法直接复制EXIF数据，我们需要使用外部库来实现
      // 首先保存处理后的图片
      const processedBuffer = await sharp(finalImageWithoutExif)
        .jpeg({ quality: 85, optimizeCoding: true })
        .toBuffer();
      
      // 使用exiftool-vendored来复制EXIF数据
      const { exiftool } = await import("exiftool-vendored");
      
      try {
        // 使用Node.js内置模块创建临时文件
        const os = await import('os');
        const fsNode = await import('fs');
        const pathModule = await import('path');
        
        // 创建临时文件路径
        const tempDir = os.tmpdir();
        const inputTempPath = pathModule.join(tempDir, `processed_${Date.now()}.jpg`);
        const originalTempPath = pathModule.join(tempDir, `original_${Date.now()}.jpg`);
        
        // 写入临时文件
        await fsNode.promises.writeFile(inputTempPath, processedBuffer);
        await fsNode.promises.writeFile(originalTempPath, originalBuffer);
        
        // 使用exiftool复制EXIF数据 - 从原始文件复制到目标文件
        await exiftool.write(inputTempPath, {
          "TagsFromFile": originalTempPath,
        }, ['-overwrite_original']);
        
        // 读取带有EXIF数据的文件
        const finalBufferWithExif = await fsNode.promises.readFile(inputTempPath);
        
        // 确保临时文件被清理
        await fsNode.promises.unlink(inputTempPath);
        await fsNode.promises.unlink(originalTempPath);
        
        // 确保print目录存在
        if ((storageProvider as any).config?.provider === 'local') {
          const basePath = (storageProvider as any).config.basePath as string
          const printDirPath = path.resolve(basePath, 'print')
          try {
            await fs.mkdir(printDirPath, { recursive: true })
            logger.image?.info(`Created print directory: ${printDirPath}`)
          } catch (error) {
            logger.image?.error(`Failed to create print directory: ${error}`)
            throw error
          }
        }

        // 保存到print目录
        const outputFileName = path.basename(storageKey)
        const printKey = `print/${outputFileName}`
        logger.image?.info(`Saving print photo to: ${printKey}`)
        await storageProvider.create(printKey, finalBufferWithExif, 'image/jpeg')

        logger.image?.success(`Print photo processed successfully: ${printKey}`)
      } finally {
        // 仅在长时间运行的应用中才需要调用end()
      }
    } else {
      // 如果没有EXIF数据，则跳过添加EXIF
      const finalImageWithoutExifProcessed = await sharp(finalImageWithoutExif)
        .jpeg({ quality: 85, optimizeCoding: true })
        .toBuffer()
      
      // 确保print目录存在
      if ((storageProvider as any).config?.provider === 'local') {
        const basePath = (storageProvider as any).config.basePath as string
        const printDirPath = path.resolve(basePath, 'print')
        try {
          await fs.mkdir(printDirPath, { recursive: true })
          logger.image?.info(`Created print directory: ${printDirPath}`)
        } catch (error) {
          logger.image?.error(`Failed to create print directory: ${error}`)
          throw error
        }
      }

      // 保存到print目录
      const outputFileName = path.basename(storageKey)
      const printKey = `print/${outputFileName}`
      logger.image?.info(`Saving print photo to: ${printKey}`)
      await storageProvider.create(printKey, finalImageWithoutExifProcessed, 'image/jpeg')

      logger.image?.success(`Print photo processed successfully: ${printKey}`)
    }
  } catch (error) {
    logger.image?.error(`Print photo processing failed: ${error}`)
    // 添加更多调试信息
    if (error instanceof Error) {
      logger.image?.error(`Error details: ${error.message}`)
      logger.image?.error(`Error stack: ${error.stack}`)
    }
    throw error
  }
}