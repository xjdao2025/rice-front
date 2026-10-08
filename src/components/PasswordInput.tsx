import { IconButton } from '@astryxdesign/core/IconButton'
import { TextInput, type TextInputProps } from '@astryxdesign/core/TextInput'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import '~/styles/password.css'

export function PasswordInput(props: Omit<TextInputProps, 'type'>) {
  const [visible, setVisible] = useState(false)

  return <div className="password-field">
    <TextInput {...props} type={visible ? 'text' : 'password'} />
    <IconButton
      className="password-visibility-button"
      type="button"
      label={visible ? '隐藏密码' : '显示密码'}
      aria-pressed={visible}
      icon={visible ? <EyeOff size={20} /> : <Eye size={20} />}
      variant="ghost"
      isDisabled={props.isDisabled}
      onClick={() => setVisible(!visible)}
    />
  </div>
}
