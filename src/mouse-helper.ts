import type { Page } from 'playwright'

/**
 * This injects a highly animated box into the page that moves with the mouse.
 * Useful for debugging and showcasing human-like movements.
 *
 * @returns `removeMouseHelper` function that removes the mouseHelper box and listeners.
 */
export async function installMouseHelper (page: Page):
Promise<{ removeMouseHelper: () => Promise<void> }> {
  // 1. Definition of attachListener logic
  const attachListenerSource = `(() => {
    const attachListener = () => {
      // Avoid duplicate installation
      if (document.querySelector('p-mouse-pointer')) return;

      const box = document.createElement('p-mouse-pointer')
      const styleElement = document.createElement('style')
      styleElement.innerHTML = \`
        p-mouse-pointer {
          pointer-events: none;
          position: absolute;
          top: 0;
          left: 0;
          width: 20px;
          height: 20px;
          background: rgba(255, 60, 60, 0.7);
          border: 2px solid #fff;
          border-radius: 50%;
          box-sizing: border-box;
          z-index: 2147483647;
          transform: translate(-50%, -50%);
          transition: left 0.15s ease-out, top 0.15s ease-out, width 0.1s, height 0.1s, background 0.1s, border-color 0.1s;
          box-shadow: 0 0 8px rgba(255, 60, 60, 0.5);
        }
        p-mouse-pointer.clicking {
          width: 14px;
          height: 14px;
          background: rgba(255, 255, 255, 0.9);
          border-color: #ff3c3c;
          box-shadow: 0 0 4px rgba(255, 60, 60, 0.8);
        }
        p-mouse-pointer.hovering {
          width: 28px;
          height: 28px;
          background: rgba(60, 120, 255, 0.6);
          border-color: #3c78ff;
          box-shadow: 0 0 12px rgba(60, 120, 255, 0.6);
        }
        p-mouse-pointer-trail {
          position: absolute;
          width: 8px;
          height: 8px;
          background: rgba(255, 60, 60, 0.4);
          border-radius: 50%;
          pointer-events: none;
          z-index: 2147483646;
          transform: translate(-50%, -50%);
          transition: opacity 0.3s ease-out, transform 0.3s ease-out;
        }
        p-click-ripple {
          position: absolute;
          width: 10px;
          height: 10px;
          border: 2px solid rgba(255, 60, 60, 0.8);
          border-radius: 50%;
          pointer-events: none;
          z-index: 2147483646;
          transform: translate(-50%, -50%) scale(0.5);
          animation: p-ripple-expand 0.4s ease-out forwards;
        }
        @keyframes p-ripple-expand {
          0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
        .p-mouse-pointer-hide {
          display: none !important;
        }
      \`;
      document.head.appendChild(styleElement)
      document.body.appendChild(box)

      // Start visible at last known position or clean initial state (100, 100)
      const initX = typeof (window as any).__lastMouseX === 'number' ? (window as any).__lastMouseX : 100
      const initY = typeof (window as any).__lastMouseY === 'number' ? (window as any).__lastMouseY : 100
      box.style.left = \`\${initX}px\`
      box.style.top = \`\${initY}px\`
      ;(window as any).__lastMouseX = initX
      ;(window as any).__lastMouseY = initY

      const onMouseMove = (event) => {
        box.style.left = \`\${event.pageX}px\`
        box.style.top = \`\${event.pageY}px\`
        box.classList.remove('p-mouse-pointer-hide')
        updateButtons(event.buttons)

        // Store state in window for persistence between playwrite-cli runs
        ;(window as any).__lastMouseX = event.pageX
        ;(window as any).__lastMouseY = event.pageY

        // Create trail dot
        const trail = document.createElement('p-mouse-pointer-trail')
        trail.style.left = \`\${event.pageX}px\`
        trail.style.top = \`\${event.pageY}px\`
        document.body.appendChild(trail)

        // Fade out and remove trail
        requestAnimationFrame(() => {
          trail.style.opacity = '0'
          trail.style.transform = 'translate(-50%, -50%) scale(0.3)'
        })
        setTimeout(() => trail.remove(), 300)
      }

      const onMouseDown = (event) => {
        updateButtons(event.buttons)
        box.classList.add(\`button-\${event.which}\`)
        box.classList.add('clicking')
        box.classList.remove('p-mouse-pointer-hide')

        // Create ripple effect
        const ripple = document.createElement('p-click-ripple')
        ripple.style.left = \`\${event.pageX}px\`
        ripple.style.top = \`\${event.pageY}px\`
        document.body.appendChild(ripple)
        setTimeout(() => ripple.remove(), 400)
      }

      const onMouseUp = (event) => {
        updateButtons(event.buttons)
        box.classList.remove(\`button-\${event.which}\`)
        box.classList.remove('clicking')
        box.classList.remove('p-mouse-pointer-hide')
      }

      const onMouseLeave = (event) => {
        updateButtons(event.buttons)
        // Do not hide the cursor to keep it visible continuously
      }

      const onMouseEnter = (event) => {
        updateButtons(event.buttons)
        box.classList.remove('p-mouse-pointer-hide')
      }

      const onMouseOver = (event) => {
        const target = event.target
        if (!target) return
        const isInteractive = target.matches('a, button, input, select, textarea, [role="button"], [tabindex="0"], [onclick]') ||
                             getComputedStyle(target).cursor === 'pointer'
        if (isInteractive) {
          box.classList.add('hovering')
        } else {
          box.classList.remove('hovering')
        }
      }

      function updateButtons (buttons) {
        for (let i = 0; i < 5; i++) {
          box.classList.toggle(\`button-\${i}\`, Boolean(buttons & (1 << i)))
        }
      }

      document.addEventListener('mousemove', onMouseMove, true)
      document.addEventListener('mousedown', onMouseDown, true)
      document.addEventListener('mouseup', onMouseUp, true)
      document.addEventListener('mouseleave', onMouseLeave, true)
      document.addEventListener('mouseenter', onMouseEnter, true)
      document.addEventListener('mouseover', onMouseOver, true)

      window._removeMouseHelper = () => {
        document.removeEventListener('mousemove', onMouseMove, true)
        document.removeEventListener('mousedown', onMouseDown, true)
        document.removeEventListener('mouseup', onMouseUp, true)
        document.removeEventListener('mouseleave', onMouseLeave, true)
        document.removeEventListener('mouseenter', onMouseEnter, true)
        document.removeEventListener('mouseover', onMouseOver, true)
        box.remove()
        styleElement.remove()
      }
    }

    if (document.readyState !== 'loading') {
      attachListener()
    } else {
      window.addEventListener('DOMContentLoaded', attachListener, false)
    }
  })()`;

  // 2. Add init script for future navigations
  await page.addInitScript(attachListenerSource);

  // 3. Immediately evaluate in the current page context so the cursor is visible right now!
  try {
    await page.evaluate(attachListenerSource);
  } catch (e) {
    // Current page might not be fully loaded or empty, ignore
  }

  async function removeMouseHelper (): Promise<void> {
    await page.evaluate(() => {
      if ((window as any)._removeMouseHelper) {
        (window as any)._removeMouseHelper()
        delete (window as any)._removeMouseHelper
      }
    })
  }

  return { removeMouseHelper }
}
