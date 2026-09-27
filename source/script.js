(() => {
  "use strict";

  const body = document.body;
  const header = document.querySelector("[data-header]");
  const progressBar = document.querySelector(".scroll-progress span");
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".main-nav");
  const navLinks = [...document.querySelectorAll(".main-nav a")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Chrome/Edge/Safari 26+ drive the progress bar from a CSS scroll timeline
  // (off the main thread); other browsers get the same scaleX from here.
  // The mobile step cards are pure CSS sticky — no scroll math at all.
  const cssProgress = Boolean(window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()"));
  const progressByScript = Boolean(progressBar) && !cssProgress;

  // Header state from an observer on a 20px sentinel: no scroll listener needed
  const headerByObserver = (() => {
    if (!header || !("IntersectionObserver" in window)) return false;
    const sentinel = document.createElement("div");
    sentinel.className = "header-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    body.appendChild(sentinel);
    new IntersectionObserver((entries) => {
      header.classList.toggle("is-scrolled", !entries[entries.length - 1].isIntersecting);
    }).observe(sentinel);
    return true;
  })();

  if (progressByScript || (header && !headerByObserver)) {
    let ticking = false;
    let dirty = true;
    let docScrollable = 1;
    let lastScale = -1;
    let headerScrolled = null;
    let lastWidth = window.innerWidth;

    // One rAF per frame: read scrollY first, re-measure only when flagged
    // (resize / content-size change) and before any write — never mid-frame layout
    const updateOnScroll = () => {
      ticking = false;
      const scrollTop = window.scrollY;
      if (progressByScript && dirty) {
        dirty = false;
        docScrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      }

      const shouldShrink = scrollTop > 20;
      if (!headerByObserver && shouldShrink !== headerScrolled) {
        headerScrolled = shouldShrink;
        header?.classList.toggle("is-scrolled", shouldShrink);
      }
      if (progressByScript) {
        const scale = Math.round(Math.min(1, scrollTop / docScrollable) * 1000) / 1000;
        if (scale !== lastScale) {
          lastScale = scale;
          progressBar.style.transform = "scaleX(" + scale + ")";
        }
      }
    };

    const requestScrollUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateOnScroll);
    };

    const invalidate = () => {
      dirty = true;
      requestScrollUpdate();
    };

    window.addEventListener("scroll", requestScrollUpdate, { passive: true });
    if (progressByScript) {
      // Phones fire resize each time the URL bar slides in/out mid-scroll;
      // only a width change needs a re-measure (the observer covers content)
      window.addEventListener(
        "resize",
        () => {
          if (window.innerWidth === lastWidth) return;
          lastWidth = window.innerWidth;
          invalidate();
        },
        { passive: true }
      );
      if ("ResizeObserver" in window) {
        new ResizeObserver(invalidate).observe(body);
      } else {
        window.addEventListener("load", invalidate);
      }
    }
    requestScrollUpdate();
  }

  const closeMenu = () => {
    body.classList.remove("menu-open");
    menuButton?.setAttribute("aria-expanded", "false");
    menuButton?.setAttribute("aria-label", "פתיחת תפריט");
  };

  menuButton?.addEventListener("click", () => {
    const willOpen = !body.classList.contains("menu-open");
    body.classList.toggle("menu-open", willOpen);
    menuButton.setAttribute("aria-expanded", String(willOpen));
    menuButton.setAttribute("aria-label", willOpen ? "סגירת תפריט" : "פתיחת תפריט");
  });

  navLinks.forEach((link) => link.addEventListener("click", closeMenu));

  document.addEventListener("click", (event) => {
    if (!body.classList.contains("menu-open")) return;
    if (navigation?.contains(event.target) || menuButton?.contains(event.target)) return;
    closeMenu();
  });

  // Hero entrance animations are pure CSS; once each finishes, detach it
  // (.reveal-settled → animation: none) so no retained animation state or
  // compositor layers linger. The resting CSS is fully visible either way.
  const heroReveals = [...document.querySelectorAll(".hero .reveal")];
  const settleHeroReveal = (element) => element.classList.add("reveal-settled");
  heroReveals.forEach((element) => {
    element.addEventListener("animationend", (event) => {
      if (event.target === element) settleHeroReveal(element);
    });
  });
  window.setTimeout(() => heroReveals.forEach(settleHeroReveal), 2400);

  // Decorative infinite loops (orbits, pulse dot, ticker) pause while their
  // section is off-screen — no animation ticks while reading the rest of the page
  if ("IntersectionObserver" in window) {
    const loopObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => entry.target.classList.toggle("is-offscreen", !entry.isIntersecting));
      },
      { rootMargin: "150px 0px" }
    );
    document.querySelectorAll(".hero, .ticker").forEach((element) => loopObserver.observe(element));
  }

  const revealElements = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );

    revealElements.forEach((element) => revealObserver.observe(element));
  }

  // The hero (no id) is observed too, so scrolling back to the top clears the highlight
  const sections = document.querySelectorAll("main section[id], .hero");
  if ("IntersectionObserver" in window) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const activeEntry = entries.filter((entry) => entry.isIntersecting).pop();
        if (!activeEntry) return;

        navLinks.forEach((link) => {
          const isActive = link.getAttribute("href") === "#" + activeEntry.target.id;
          link.classList.toggle("is-active", isActive);
          if (isActive) {
            link.setAttribute("aria-current", "true");
          } else {
            link.removeAttribute("aria-current");
          }
        });
      },
      { rootMargin: "-28% 0px -58% 0px" }
    );

    sections.forEach((section) => sectionObserver.observe(section));
  }

  const faqItems = [...document.querySelectorAll(".faq-list details")];
  faqItems.forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      faqItems.forEach((otherItem) => {
        if (otherItem !== item) otherItem.open = false;
      });
    });
  });

  const form = document.querySelector("#lead-form");
  const submitButton = form?.querySelector(".form-submit");
  const formStatus = form?.querySelector(".form-status");
  const modal = document.querySelector("#success-modal");
  const closeModalButton = modal?.querySelector("[data-close-success]");
  let previousFocus = null;

  const validateField = (field) => {
    const label = field.closest("label");
    const isValid = field.checkValidity();
    label?.classList.toggle("has-error", !isValid);
    field.setAttribute("aria-invalid", String(!isValid));
    return isValid;
  };

  form?.querySelectorAll("input[required], textarea[required]").forEach((field) => {
    field.addEventListener("blur", () => validateField(field));
    field.addEventListener("input", () => {
      if (field.closest("label")?.classList.contains("has-error")) validateField(field);
    });
  });

  const createConfetti = () => {
    const layer = modal?.querySelector(".success-confetti");
    if (!layer || reduceMotion) return;

    const colors = ["#d48a4a", "#f2b873", "#fffdf8", "#25d366"];
    for (let index = 0; index < 28; index += 1) {
      const piece = document.createElement("i");
      const angle = (Math.PI * 2 * index) / 28 + Math.random() * 0.25;
      const distance = 120 + Math.random() * 210;
      piece.className = "confetti-piece";
      piece.style.background = colors[index % colors.length];
      piece.style.setProperty("--x", Math.cos(angle) * distance + "px");
      piece.style.setProperty("--y", Math.sin(angle) * distance + 90 + "px");
      piece.style.setProperty("--r", Math.random() * 900 - 450 + "deg");
      piece.style.animationDelay = Math.random() * 0.15 + "s";
      layer.appendChild(piece);
      window.setTimeout(() => piece.remove(), 1500);
    }
  };

  const openSuccessModal = () => {
    if (!modal) return;
    previousFocus = document.activeElement;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    body.classList.add("modal-open");
    window.requestAnimationFrame(() => {
      modal.classList.add("is-open");
      closeModalButton?.focus();
      createConfetti();
    });
  };

  const closeSuccessModal = () => {
    if (!modal) return;
    modal.classList.remove("is-open");
    body.classList.remove("modal-open");
    window.setTimeout(() => {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      previousFocus?.focus();
    }, reduceMotion ? 0 : 300);
  };

  closeModalButton?.addEventListener("click", closeSuccessModal);
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) closeSuccessModal();
  });

  modal?.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || modal.hidden) return;
    const focusables = [...modal.querySelectorAll("button, a[href]")].filter(
      (element) => !element.disabled && element.offsetParent !== null
    );
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (modal && !modal.hidden) {
      closeSuccessModal();
    } else {
      closeMenu();
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton?.classList.contains("is-loading")) return;

    const requiredFields = [...form.querySelectorAll("input[required], textarea[required]")];
    const invalidFields = requiredFields.filter((field) => !validateField(field));

    if (invalidFields.length) {
      invalidFields[0].focus();
      if (formStatus) {
        formStatus.textContent = "יש להשלים את השדות המסומנים לפני השליחה.";
        formStatus.classList.add("is-visible");
      }
      return;
    }

    submitButton?.classList.add("is-loading");
    submitButton?.setAttribute("disabled", "");
    submitButton?.setAttribute("aria-busy", "true");
    if (formStatus) {
      formStatus.textContent = "";
      formStatus.classList.remove("is-visible");
    }

    try {
      // Netlify Forms: urlencoded POST to the site root; a 2xx means the submission was stored.
      const response = await fetch("/", {
        method: "POST",
        body: new URLSearchParams(new FormData(form)).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
      if (!response.ok) throw new Error("Submission failed");

      form.reset();
      requiredFields.forEach((field) => {
        field.removeAttribute("aria-invalid");
        field.closest("label")?.classList.remove("has-error");
      });
      openSuccessModal();
    } catch (error) {
      if (formStatus) {
        formStatus.innerHTML =
          'לא הצלחנו לשלוח כרגע. אפשר לדבר איתי מיד ב־<a href="https://wa.me/972585308645" target="_blank" rel="noopener">וואטסאפ</a> או בטלפון.';
        formStatus.classList.add("is-visible");
      }
    } finally {
      submitButton?.classList.remove("is-loading");
      submitButton?.removeAttribute("disabled");
      submitButton?.removeAttribute("aria-busy");
    }
  });

  if (window.matchMedia("(pointer: fine)").matches && !reduceMotion) {
    document.querySelectorAll(".magnetic").forEach((element) => {
      element.addEventListener("pointermove", (event) => {
        const bounds = element.getBoundingClientRect();
        const offsetX = event.clientX - bounds.left - bounds.width / 2;
        const offsetY = event.clientY - bounds.top - bounds.height / 2;
        element.style.transform = "translate(" + offsetX * 0.07 + "px, " + offsetY * 0.08 + "px)";
      });

      element.addEventListener("pointerleave", () => {
        element.style.transform = "";
      });
    });
  }

  const year = document.querySelector("#current-year");
  if (year) year.textContent = new Date().getFullYear();
})();
