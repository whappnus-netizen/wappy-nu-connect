-- Allow supported video MIME types for automation tutorial media.
-- Preserve existing audio/image types and the current 20 MiB bucket limit.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(
    coalesce(allowed_mime_types, array[]::text[])
    || array['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp']::text[]
  ) as mime_type
  order by mime_type
)
where id = 'automation-media';
