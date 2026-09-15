/*
 * mpq_extract: copy every file whose path starts with a prefix out of a list
 * of MPQ archives, in the order given (later archives overwrite earlier ones,
 * so pass them lowest priority first). Paths are lowercased and '\' becomes '/'.
 *
 *   mpq_extract <outdir> <prefix> <archive.MPQ>...
 *
 * Build (links the libmpq that the AzerothCore build already produced):
 *   cc -O2 -o mpq_extract mpq_extract.c \
 *      -I/opt/wow/azerothcore-wotlk/deps/libmpq \
 *      /opt/wow/azerothcore-wotlk/build/deps/libmpq/libmpq.a -lz -lbz2
 */

#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "libmpq/mpq.h"

static int make_parents(char *path)
{
    for (char *p = path + 1; *p; ++p)
    {
        if (*p != '/')
            continue;
        *p = '\0';
        if (mkdir(path, 0755) != 0 && errno != EEXIST)
        {
            *p = '/';
            return -1;
        }
        *p = '/';
    }
    return 0;
}

static unsigned char *read_file(mpq_archive_s *mpq, uint32_t number, libmpq__off_t *size)
{
    if (libmpq__file_unpacked_size(mpq, number, size) != 0)
        return NULL;
    unsigned char *buf = malloc(*size + 1);
    libmpq__off_t got = 0;
    if (!buf || libmpq__file_read(mpq, number, buf, *size, &got) != 0 || got != *size)
    {
        free(buf);
        return NULL;
    }
    buf[*size] = '\0';
    return buf;
}

int main(int argc, char **argv)
{
    if (argc < 4)
    {
        fprintf(stderr, "usage: %s <outdir> <prefix> <archive>...\n", argv[0]);
        return 2;
    }

    char const *outdir = argv[1];
    char prefix[512];
    snprintf(prefix, sizeof prefix, "%s", argv[2]);
    for (char *p = prefix; *p; ++p)
        *p = *p == '/' ? '\\' : tolower((unsigned char)*p);
    size_t prefixLen = strlen(prefix);

    int total = 0;
    for (int a = 3; a < argc; ++a)
    {
        mpq_archive_s *mpq = NULL;
        if (libmpq__archive_open(&mpq, argv[a], -1) != 0)
        {
            fprintf(stderr, "cannot open %s\n", argv[a]);
            return 1;
        }

        uint32_t listNumber;
        libmpq__off_t listSize;
        unsigned char *list = NULL;
        if (libmpq__file_number(mpq, "(listfile)", &listNumber) == 0)
            list = read_file(mpq, listNumber, &listSize);
        if (!list)
        {
            fprintf(stderr, "%s: no (listfile), skipped\n", argv[a]);
            libmpq__archive_close(mpq);
            continue;
        }

        int count = 0;
        for (char *line = strtok((char *)list, "\r\n"); line; line = strtok(NULL, "\r\n"))
        {
            char lower[512];
            snprintf(lower, sizeof lower, "%s", line);
            for (char *p = lower; *p; ++p)
                *p = tolower((unsigned char)*p);
            if (strncmp(lower, prefix, prefixLen) != 0)
                continue;

            uint32_t number;
            libmpq__off_t size;
            if (libmpq__file_number(mpq, line, &number) != 0)
                continue;
            unsigned char *data = read_file(mpq, number, &size);
            if (!data)
            {
                fprintf(stderr, "%s: failed to read %s\n", argv[a], line);
                continue;
            }

            char out[1024];
            snprintf(out, sizeof out, "%s/%s", outdir, lower);
            for (char *p = out + strlen(outdir); *p; ++p)
                if (*p == '\\')
                    *p = '/';
            FILE *f = NULL;
            if (make_parents(out) == 0)
                f = fopen(out, "wb");
            if (!f || fwrite(data, 1, size, f) != (size_t)size)
                fprintf(stderr, "cannot write %s\n", out);
            else
                ++count;
            if (f)
                fclose(f);
            free(data);
        }

        printf("%s: %d files\n", argv[a], count);
        total += count;
        free(list);
        libmpq__archive_close(mpq);
    }

    printf("total %d files written (overwrites counted)\n", total);
    return 0;
}
