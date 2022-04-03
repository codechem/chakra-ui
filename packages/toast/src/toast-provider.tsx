import { objectKeys } from "@chakra-ui/utils"
import { AnimatePresence, Variants } from "framer-motion"
import * as React from "react"
import { createContext } from "@chakra-ui/react-utils"
import { Portal } from "@chakra-ui/portal"
import { ToastWrapperProps, ToastWrapper } from "./toast-wrapper"
import type { ToastPosition } from "./toast.placement"
import type {
  CloseAllToastsOptions,
  ToastId,
  ToastMessage,
  ToastOptions,
  ToastState,
} from "./toast.types"
import { findToast, getToastPosition } from "./toast.utils"
import type { UseToastOptions } from "./use-toast"

export interface ToastMethods {
  notify: (message: ToastMessage, options?: CreateToastOptions) => ToastId
  closeAll: (options?: CloseAllToastsOptions) => void
  close: (id: ToastId) => void
  update: (
    id: ToastId,
    options: CreateToastOptions & { message?: ToastMessage },
  ) => void
  isActive: (id: ToastId) => boolean
}

export type CreateToastOptions = Partial<
  Pick<
    ToastOptions,
    | "status"
    | "duration"
    | "position"
    | "id"
    | "onCloseComplete"
    | "containerStyle"
  >
>

/**
 * Static id counter to create unique ids
 * for each toast
 */
let counter = 0

const [ToastManagerProvider, useToastManager] = createContext<ToastMethods>({
  strict: true,
  name: "ToastManagerContext",
})

export { useToastManager }

export type ToastManagerProps = React.PropsWithChildren<{
  defaultOptions?: UseToastOptions
  motion?: Variants
  toastComponent?: React.FC<ToastWrapperProps>
}>

/**
 * Manages the creation, and removal of toasts
 * across all corners ("top", "bottom", etc.)
 */
export const ToastProvider = React.forwardRef<ToastMethods, ToastManagerProps>(
  (props: ToastManagerProps, ref) => {
    const { children, defaultOptions, motion, toastComponent } = props

    const { areas, getStyle, toast } = useToastProvider({
      ...defaultOptions,
      motion,
      toastComponent,
    })

    // attach `toast` methods to the ref of this component
    React.useImperativeHandle(ref, () => toast)

    const toastList = objectKeys(areas).map((position) => {
      const toasts = areas[position]

      return (
        <ul
          key={position}
          id={`chakra-toast-manager-${position}`}
          style={getStyle(position)}
        >
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <ToastWrapper key={toast.id} {...toast} />
            ))}
          </AnimatePresence>
        </ul>
      )
    })

    return (
      <ToastManagerProvider value={toast}>
        {children}
        <Portal>{toastList}</Portal>
      </ToastManagerProvider>
    )
  },
)

function useToastProvider(
  defaultOptions: Omit<ToastManagerProps, "children"> = {},
) {
  /**
   * State to track all the toast across all positions
   */
  const [areas, setAreas] = React.useState<ToastState>({
    top: [],
    "top-left": [],
    "top-right": [],
    "bottom-left": [],
    bottom: [],
    "bottom-right": [],
  })

  /**
   * Compute the style of a toast based on its position
   */
  const getStyle = (position: ToastPosition): React.CSSProperties => {
    const isTopOrBottom = position === "top" || position === "bottom"
    const margin = isTopOrBottom ? "0 auto" : undefined

    const top = position.includes("top")
      ? "env(safe-area-inset-top, 0px)"
      : undefined
    const bottom = position.includes("bottom")
      ? "env(safe-area-inset-bottom, 0px)"
      : undefined
    const right = !position.includes("left")
      ? "env(safe-area-inset-right, 0px)"
      : undefined
    const left = !position.includes("right")
      ? "env(safe-area-inset-left, 0px)"
      : undefined

    return {
      position: "fixed",
      zIndex: 5500,
      pointerEvents: "none",
      display: "flex",
      flexDirection: "column",
      margin,
      top,
      bottom,
      right,
      left,
    }
  }

  const toast = React.useMemo(() => {
    /**
     * Function to actually create a toast and add it
     * to state at the specified position
     */
    const notify: ToastMethods["notify"] = (message, options) => {
      const toast = createToast(message, {
        ...defaultOptions,
        ...options,
      } as CreateToastOptions)
      const { position, id } = toast

      setAreas((prevToasts) => {
        const isTop = position.includes("top")

        /**
         * - If the toast is positioned at the top edges, the
         * recent toast stacks on top of the other toasts.
         *
         * - If the toast is positioned at the bottom edges, the recent
         * toast stacks below the other toasts.
         */
        const toasts = isTop
          ? [toast, ...(prevToasts[position] ?? [])]
          : [...(prevToasts[position] ?? []), toast]

        return {
          ...prevToasts,
          [position]: toasts,
        }
      })

      return id
    }

    /**
     * Update a specific toast with new options based on the
     * passed `id`
     */
    const update: ToastMethods["update"] = (
      id: ToastId,
      options: CreateToastOptions & { message?: ToastMessage },
    ) => {
      setAreas((prevState) => {
        const nextState = { ...prevState }
        const { position, index } = findToast(nextState, id)

        if (position && index !== -1) {
          nextState[position][index] = {
            ...nextState[position][index],
            ...options,
          }
        }

        return nextState
      })
    }

    /**
     * Close all toasts at once.
     * If given positions, will only close those.
     */
    const closeAll: ToastMethods["closeAll"] = ({ positions } = {}) => {
      // only one setState here for perf reasons
      // instead of spamming this.closeToast
      setAreas((prev) => {
        const allPositions: ToastPosition[] = [
          "bottom",
          "bottom-right",
          "bottom-left",
          "top",
          "top-left",
          "top-right",
        ]

        const positionsToClose = positions ?? allPositions

        return positionsToClose.reduce((acc, position) => {
          acc[position] = prev[position].map((toast) => ({
            ...toast,
            requestClose: true,
          }))

          return acc
        }, {} as ToastState)
      })
    }

    /**
     * Create properties for a new toast
     */
    const createToast = (
      message: ToastMessage,
      options: CreateToastOptions,
    ) => {
      counter += 1
      const id = options.id ?? counter

      const position = options.position ?? "top"

      /**
       * Delete a toast record at its position
       */
      const removeToast = (id: ToastId, position: ToastPosition) => {
        setAreas((prevState) => ({
          ...prevState,
          // id may be string or number
          // eslint-disable-next-line eqeqeq
          [position]: prevState[position].filter((toast) => toast.id != id),
        }))
      }

      return {
        id,
        message,
        position,
        duration: options.duration,
        onCloseComplete: options.onCloseComplete,
        onRequestRemove: () => removeToast(String(id), position),
        status: options.status,
        requestClose: false,
        containerStyle: options.containerStyle,
      }
    }

    /**
     * Requests to close a toast based on its id and position
     */
    const close: ToastMethods["close"] = (id) => {
      setAreas((prevState) => {
        const position = getToastPosition(prevState, id)

        if (!position) return prevState

        return {
          ...prevState,
          [position]: prevState[position].map((toast) => {
            // id may be string or number
            // eslint-disable-next-line eqeqeq
            if (toast.id == id) {
              return {
                ...toast,
                requestClose: true,
              }
            }

            return toast
          }),
        }
      })
    }

    const isActive: ToastMethods["isActive"] = (id) => {
      const { position } = findToast(areas, id)
      return Boolean(position)
    }

    return {
      notify,
      closeAll,
      close,
      update,
      isActive,
    }
  }, [defaultOptions, areas])

  return {
    areas,
    getStyle,
    toast,
  }
}
