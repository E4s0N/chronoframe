<script setup lang="ts">
import { z } from 'zod'

definePageMeta({
  layout: 'onboarding',
})

const router = useRouter()

// Use wizard form for 'app' namespace (site settings)
const {
  fields,
  state,
  loading: fetchingSchema,
  isFieldVisible,
} = useWizardForm('app')

const schema = computed(() => {
  const s: Record<string, any> = {}
  fields.value.forEach((field) => {
    if (!isFieldVisible(field)) return

    let validator: z.ZodTypeAny

    if (field.ui.type === 'number') {
      // Handle number type fields properly
      validator = z.coerce.number()
      if (field.ui.required) {
        validator = (validator as z.ZodNumber).min(
          1,
          `${field.label} is required`,
        )
      }
    } else if (field.ui.type === 'url') {
      const urlValidator = z.string().url('Invalid URL')
      if (field.ui.required) {
        validator = urlValidator.min(1, `${field.label} is required`)
      } else {
        validator = urlValidator.optional().or(z.literal(''))
      }
    } else {
      const stringValidator = z.string()
      if (field.ui.required) {
        validator = stringValidator.min(1, `${field.label} is required`)
      } else {
        validator = stringValidator.optional()
      }
    }

    s[field.key] = validator
  })
  return z.object(s)
})

function onSubmit() {
  // Validation passed, data is already in the store via useWizardForm binding
  router.push('/onboarding/storage')
}
</script>

<template>
  <WizardStep
    title="站点信息"
    description="配置站点基本信息"
  >
    <div
      v-if="fetchingSchema"
      class="flex justify-center py-8"
    >
      <UIcon
        name="tabler:loader"
        class="animate-spin w-8 h-8 text-gray-400"
      />
    </div>

    <UForm
      v-else
      id="site-form"
      :schema="schema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
    >
      <template
        v-for="field in fields"
        :key="field.key"
      >
        <WizardFormField
          v-if="isFieldVisible(field)"
          :label="$t(field.label || '')"
          :name="field.key"
          :required="field.ui.required"
          :help="$t(field.ui.help || '')"
        >
          <WizardInput
            v-if="field.ui.type === 'number'"
            v-model.number="state[field.key]"
            type="number"
            :placeholder="field.ui.placeholder"
          />
          <WizardInput
            v-else
            v-model="state[field.key]"
            :type="field.ui.type === 'url' ? 'url' : 'text'"
            :placeholder="field.ui.placeholder"
          />
        </WizardFormField>
      </template>
    </UForm>

    <template #actions>
      <WizardButton
        type="submit"
        form="site-form"
        color="primary"
        size="lg"
        :disabled="fetchingSchema"
        trailing-icon="tabler:arrow-right"
      >
        下一步
      </WizardButton>
    </template>
  </WizardStep>
</template>
