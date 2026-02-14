<script lang="ts" setup>
import { motion, AnimatePresence } from 'motion-v'

interface Props {
  isOpen: boolean
  photo: Photo
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const toast = useToast()
const { gtag } = useGtag()

// Print image URL and loading state
const printImageLoading = ref(true)
const printImageError = ref(false)
const loadingTimer = ref<NodeJS.Timeout | null>(null)

const printImageUrl = computed(() => {
  if (typeof window !== 'undefined' && props.photo.storageKey) {
    // 使用与普通图片相同的路径格式，但指向print子目录
    // 移除可能的 'photos/' 前缀，然后添加到print路径
    const cleanStorageKey = props.photo.storageKey.startsWith('photos/') 
      ? props.photo.storageKey.substring(7) // 'photos/'.length = 7
      : props.photo.storageKey
    
    // 构造打印图片的路径：/storage/print/原始文件名
    const fileName = cleanStorageKey.split('/').pop() || cleanStorageKey
    return `${window.location.origin}/storage/print/${fileName}`
  }
  return ''
})

// Reset loading state when photo changes or modal opens
const resetLoadingState = () => {
  printImageLoading.value = true
  printImageError.value = false

  // Clear existing timer
  if (loadingTimer.value) {
    clearTimeout(loadingTimer.value)
  }

  // Set a timeout to handle cases where onload/onerror never fires
  loadingTimer.value = setTimeout(() => {
    if (printImageLoading.value) {
      printImageLoading.value = false
      printImageError.value = true
    }
  }, 15000) // 15 second timeout for print images (longer due to processing)
}

// Reset loading state when photo changes
watch(() => props.photo.id, resetLoadingState)

// Reset loading state when modal opens
watch(
  () => props.isOpen,
  (newValue) => {
    if (newValue) {
      resetLoadingState()
    }
  },
)

// Handle image load events
const handlePrintImageLoad = () => {
  if (loadingTimer.value) {
    clearTimeout(loadingTimer.value)
    loadingTimer.value = null
  }
  printImageLoading.value = false
  printImageError.value = false
}

const handlePrintImageError = () => {
  if (loadingTimer.value) {
    clearTimeout(loadingTimer.value)
    loadingTimer.value = null
  }
  printImageLoading.value = false
  printImageError.value = true
}

// Cleanup on unmount
onUnmounted(() => {
  if (loadingTimer.value) {
    clearTimeout(loadingTimer.value)
  }
})

// Download print image
const downloadPrintImage = async () => {
  try {
    const response = await fetch(printImageUrl.value)
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const extension = props.photo.originalUrl!.split('.').pop() || 'jpg'
    link.download = `${props.photo.title || 'photo'}-print.${extension}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    // Track download event in Google Analytics
    gtag('event', 'photo_download', {
      photo_id: props.photo.id,
      photo_title: props.photo.title || 'Untitled',
      download_type: 'print',
    })

    toast.add({
      title: $t('ui.action.print.success.printImageDownloaded'),
      color: 'success',
      icon: 'tabler:download',
      duration: 3000,
    })
  } catch (error) {
    toast.add({
      title: $t('ui.action.print.error.printImageDownloadFailed'),
      description: (error as Error)?.message || 'Unknown error',
      color: 'error',
      icon: 'tabler:x',
      duration: 3000,
    })
  }
}

// Close modal when clicking outside
const handleBackdropClick = (event: MouseEvent) => {
  if (event.target === event.currentTarget) {
    emit('close')
  }
}

// Keyboard shortcuts
defineShortcuts({
  escape: () => {
    emit('close')
  },
})
</script>

<template>
  <Teleport to="body">
    <AnimatePresence>
      <motion.div
        v-if="isOpen"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: 0.2 }"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        @click="handleBackdropClick"
      >
        <motion.div
          :initial="{ opacity: 0, scale: 0.95, y: 20 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="{ opacity: 0, scale: 0.95, y: 20 }"
          :transition="{
            type: 'spring',
            duration: 0.3,
            bounce: 0.1,
          }"
          class="relative mx-4 w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-white/90 shadow-2xl backdrop-blur-2xl dark:bg-neutral-900/90"
          @click.stop
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between border-b border-white/10 p-4"
          >
            <div class="flex items-center gap-2">
              <Icon
                name="tabler:printer"
                class="size-5 text-neutral-700 dark:text-neutral-300"
              />
              <h3
                class="text-lg font-semibold text-neutral-900 dark:text-white"
              >
                {{ $t('ui.action.print.title') }}
              </h3>
            </div>
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="tabler:x"
              @click="emit('close')"
            />
          </div>

          <!-- Content -->
          <div
            v-if="photo"
            class="p-4"
          >
            <div class="space-y-4">
              <!-- Print Image Preview -->
              <div
                class="rounded-lg border border-neutral-200/50 bg-neutral-50/50 p-3 dark:border-neutral-700/50 dark:bg-neutral-800/50"
              >
                <div class="flex items-center justify-between mb-2">
                  <label
                    class="block text-xs font-medium text-neutral-600 dark:text-neutral-400"
                  >
                    {{ $t('ui.action.print.preview.title') }}
                  </label>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    icon="tabler:download"
                    @click="downloadPrintImage"
                    :disabled="printImageLoading || printImageError"
                  >
                    {{ $t('ui.action.print.actions.downloadPrintImage') }}
                  </UButton>
                </div>
                <div
                  class="relative rounded-md bg-neutral-100/50 dark:bg-neutral-700/50 overflow-hidden"
                >
                  <!-- Loading indicator -->
                  <div
                    v-if="printImageLoading"
                    class="flex items-center justify-center bg-neutral-100/50 dark:bg-neutral-700/50 aspect-[3/4]"
                  >
                    <div class="flex flex-col items-center gap-2">
                      <Icon
                        name="tabler:loader-2"
                        class="size-6 text-neutral-500 animate-spin"
                      />
                      <span
                        class="text-xs text-neutral-500 dark:text-neutral-400"
                      >
                        {{ $t('ui.action.print.preview.loading') }}
                      </span>
                      <p class="text-xs text-neutral-500 dark:text-neutral-400 max-w-xs text-center mt-1">
                        {{ $t('ui.action.print.preview.processingHint') }}
                      </p>
                    </div>
                  </div>

                  <!-- Error state -->
                  <div
                    v-else-if="printImageError"
                    class="flex items-center justify-center bg-neutral-100/50 dark:bg-neutral-700/50 aspect-[3/4]"
                  >
                    <div class="flex flex-col items-center gap-2">
                      <Icon
                        name="tabler:photo-off"
                        class="size-6 text-neutral-400"
                      />
                      <span
                        class="text-xs text-neutral-500 dark:text-neutral-400"
                      >
                        {{ $t('ui.action.print.preview.loadError') }}
                      </span>
                      <p class="text-xs text-neutral-500 dark:text-neutral-400 max-w-xs text-center mt-1">
                        {{ $t('ui.action.print.preview.retryHint') }}
                      </p>
                    </div>
                  </div>

                  <!-- Print Image -->
                  <img
                    v-show="!printImageLoading && !printImageError"
                    :key="`print-image-${props.photo.id}-${Date.now()}`"
                    :src="printImageUrl"
                    :alt="$t('ui.action.print.preview.alt')"
                    class=""
                    loading="eager"
                    @load="handlePrintImageLoad"
                    @error="handlePrintImageError"
                  />
                </div>
              </div>

              <!-- Info -->
              <!-- <div class="text-xs text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800/50 p-3 rounded-lg">
                <p>{{ $t('ui.action.print.info.description') }}</p>
                <ul class="mt-1 space-y-1 list-disc pl-4">
                  <li>{{ $t('ui.action.print.info.features.watermark') }}</li>
                  <li>{{ $t('ui.action.print.info.features.optimizedRatio') }}</li>
                  <li>{{ $t('ui.action.print.info.features.exifData') }}</li>
                </ul>
              </div> -->
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>

<style scoped></style>