FROM golang:1.23-alpine AS build
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/listener ./cmd/listener \
 && CGO_ENABLED=0 go build -o /out/scorer ./cmd/scorer \
 && CGO_ENABLED=0 go build -o /out/api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/listener /out/scorer /out/api /usr/local/bin/
EXPOSE 8080
CMD ["listener"]
