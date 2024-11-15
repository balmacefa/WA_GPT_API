# Use Puppeteer image as the base
FROM ghcr.io/puppeteer/puppeteer:22.7.1 as builder_runtime
# Change ownership of the application directory to the pptruser
# and install pnpm globally as root

# Copy application source
COPY . /app/

# Set working directory
WORKDIR /app

USER root
# rename .env-cmdrc.example to .env-cmdrc

RUN npm install -g pnpm
RUN chown -R pptruser:pptruser /app
# Check if the directory exists, create it if not, and set the ownership
RUN [ ! -d /app/.wwebjs_auth ] && mkdir -p /app/.wwebjs_auth || true
RUN chown -R pptruser:pptruser /app/.wwebjs_auth

# Switch back to non-root user
USER pptruser

# Install dependencies and build the project using pnpm
RUN pnpm install
RUN pnpm run build

RUN ls -laR

EXPOSE 3344

# Start the app
CMD ["pnpm", "run", "start"]

# check if voume is mounted, wa_session /app/.wwebjs_auth,
